{
  lib,
  testers,
  python3,
  openssl,
  server,
}:

let
  mcpService = port: allowWrites: {
    wantedBy = [ "multi-user.target" ];
    after = [ "xmatters-fixture.service" ];
    requires = [ "xmatters-fixture.service" ];
    environment = {
      XMATTERS_BASE_URL = "https://example.xmatters.com";
      XMATTERS_API_KEY = "x-api-key-synthetic-e2e"; # Synthetic VM-only key. gitleaks:allow
      XMATTERS_API_SECRET = "synthetic-upstream-secret";
      XMATTERS_MCP_TOKEN = "synthetic-e2e-mcp-token-0123456789abcdef";
      XMATTERS_MCP_PORT = toString port;
      XMATTERS_ALLOW_WRITES = lib.boolToString allowWrites;
      XMATTERS_TIMEOUT_MS = "5000";
      NODE_EXTRA_CA_CERTS = "/var/lib/xmatters-fixture/cert.pem";
    };
    serviceConfig = {
      # Run the actual installed executable, not an imported start() or mocked fetch.
      ExecStart = "${lib.getExe server}";
      DynamicUser = true;
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      TimeoutStopSec = 10;
    };
  };
in

testers.runNixOSTest {
  name = "xmatters-mcp-e2e";
  globalTimeout = 180;
  # Fail rather than quietly falling back to a very slow emulator.
  requiredFeatures.kvm = true;

  nodes.machine = _: {
    virtualisation = {
      memorySize = 1024;
      cores = 2;
      # No user-mode NAT adapter, no forwarded host ports, no external DNS route.
      vlans = lib.mkForce [ ];
      # An empty list alone merges with NixOS defaults. Force -nic none to also
      # prevent QEMU from synthesizing a default SLiRP adapter.
      qemu.networkingOptions = lib.mkForce [ "-nic none" ];
    };
    networking.hosts."127.0.0.1" = [ "example.xmatters.com" ];
    environment.systemPackages = [
      python3
      server
    ];

    systemd.services = {
      xmatters-fixture = {
        wantedBy = [ "multi-user.target" ];
        path = [ openssl ];
        preStart = ''
          umask 077
          openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
            -subj /CN=example.xmatters.com \
            -addext subjectAltName=DNS:example.xmatters.com \
            -keyout /var/lib/xmatters-fixture/key.pem \
            -out /var/lib/xmatters-fixture/cert.pem 2>/dev/null
          chmod 644 /var/lib/xmatters-fixture/cert.pem
        '';
        serviceConfig = {
          ExecStart = "${python3}/bin/python ${../tests/e2e/fixture.py}";
          StateDirectory = "xmatters-fixture";
          StateDirectoryMode = "0755";
          WorkingDirectory = "/var/lib/xmatters-fixture";
        };
      };
      xmatters-mcp-readonly = mcpService 3000 false;
      xmatters-mcp-writable = mcpService 3001 true;
    };
  };

  testScript = ''
    import json
    import shlex

    start_all()
    try:
        machine.wait_for_unit("xmatters-fixture.service")
        machine.wait_for_open_port(443)
        for name, port in [("readonly", 3000), ("writable", 3001)]:
            machine.wait_for_unit(f"xmatters-mcp-{name}.service")
            machine.wait_for_open_port(port)
        with subtest("no network interfaces except VM loopback"):
            interfaces = json.loads(machine.succeed("ip -j link show"))
            assert {interface["ifname"] for interface in interfaces} == {"lo"}
        with subtest("real HTTP MCP and verified HTTPS upstream acceptance"):
            machine.succeed(
                "E2E_CATALOG=${server}/lib/node_modules/@robertsmieja/xmatters-mcp/dist/operations.json "
                "E2E_JOURNAL=/var/lib/xmatters-fixture/requests.jsonl "
                "${python3}/bin/python ${../tests/e2e/verify.py}"
            )
        with subtest("synthetic-only upstream traffic"):
            requests = json.loads(machine.succeed(
                "${python3}/bin/python -c " + shlex.quote(
                    "import json; from pathlib import Path; "
                    "print(json.dumps([json.loads(line) for line in "
                    "Path('/var/lib/xmatters-fixture/requests.jsonl').read_text().splitlines()]))"
                )
            ))
            assert requests and all(entry["authenticated"] for entry in requests)
            from collections import Counter
            expected = [
                ("GET", "/api/xm/1/people?limit=1&offset=0"),
                ("POST", "/api/xm/1/forms/synthetic-form/scenarios/synthetic-scenario/attachments"),
                ("GET", "/api/xm/1/events/synthetic-event/attachments/synthetic.txt"),
                ("GET", "/api/xm/1/people?limit=1&offset=429"),
                ("GET", "/api/xm/1/people?limit=1&offset=302"),
                ("POST", "/api/xm/1/people"),
                ("GET", "/api/xm/1/people/synthetic-created"),
                ("DELETE", "/api/xm/1/people/synthetic-created"),
                ("GET", "/api/xm/1/people/synthetic-created"),
            ]
            assert Counter((entry["method"], entry["path"]) for entry in requests) == Counter(expected)
        with subtest("clean shutdown and closed listeners"):
            for name, port in [("readonly", 3000), ("writable", 3001)]:
                machine.succeed(f"systemctl stop xmatters-mcp-{name}.service")
                assert machine.succeed(
                    f"systemctl show xmatters-mcp-{name}.service -p ExecMainStatus --value"
                ).strip() == "0"
                machine.wait_for_closed_port(port)
        with subtest("no credential leakage in service journals"):
            journal = machine.succeed("journalctl --no-pager -u xmatters-mcp-readonly -u xmatters-mcp-writable -u xmatters-fixture")
            for secret in ["x-api-key-synthetic-e2e", "synthetic-upstream-secret", "synthetic-e2e-mcp-token-0123456789abcdef"]:
                assert secret not in journal
    finally:
        print(machine.succeed("journalctl --no-pager -u xmatters-mcp-readonly -u xmatters-mcp-writable -u xmatters-fixture"))
  '';
}
