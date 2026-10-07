# Opt-in Nix end-to-end test

The test builds the server from the checked-out source, boots a disposable NixOS VM, and runs the installed `xmatters-mcp` executable as a systemd service. An independent Python client sends real MCP HTTP requests. The server uses its normal, unmodified REST client to contact a synthetic upstream over HTTPS.

This is **not a live xMatters tenant test**. The upstream implements only the routes and payloads needed by these scenarios. It does not establish tenant permissions, vendor payload semantics or notification delivery.

## Run locally

From the repository root on Linux with Nix, flakes enabled and accessible KVM:

```sh
nix build .#e2e --print-build-logs --out-link result-e2e
```

The first build downloads the pinned Nixpkgs packages and npm dependencies. You do not need a host Node installation, Docker, sudo, a system rebuild or xMatters credentials. Nix build workers must have access to `/dev/kvm`, and the builder must advertise `kvm` and `nixos-test` in its system features. On a non-NixOS Linux machine, the Nix installer and KVM permissions still need to be configured by the operator.

Nix caches successful test results. To force another execution without changing source:

```sh
nix build .#e2e --rebuild --print-build-logs --out-link result-e2e
```

Inspect the build log with:

```sh
nix log .#e2e
```

For a failed run, use `--keep-failed` to retain the driver work directory. The Nix error reports its path. Read successful-run output with `nix log .#e2e`; `result-e2e/` is an empty success marker, not a driver-log archive. The driver shuts down the VM on completion or failure; no service is installed on the host.

The flake exports Linux packages for `x86_64-linux` and `aarch64-linux`. The manual CI job exercises x86-64. Native ARM requires an ARM KVM builder; macOS and Windows are not supported by this test target.

## Run through GitHub Actions

Use **Actions → Nix end-to-end → Run workflow** to select a ref and start a run. Once this workflow is on the default branch, it is also available through the CLI:

```sh
gh workflow run e2e.yml --ref main
gh run list --workflow e2e.yml --limit 5
```

The workflow has only `workflow_dispatch`: pushes and pull requests do not start it. It installs Nix, checks KVM, runs the same `nix build .#e2e` target, and uploads `e2e-build.log`. It requires no tenant secrets and has read-only repository permissions.

The expensive VM target is a **package**, not a flake `check`. It is not included in `npm run check`, `npm test`, the regular CI workflow or `nix flake check`.

## What is exercised

- The Nix build, production dependencies, catalog JSON, executable wrapper and actual service startup.
- Modern MCP discovery, authenticated HTTP requests, tool enumeration and the catalog resource; all tool names and catalog-resource operations are compared to the packaged catalog rather than a duplicated count. This VM suite does not assert tool schemas or annotations.
- Real HTTPS with a VM-local certificate, hostname resolution and upstream API-key Basic authentication.
- GET route/query construction with simple identifiers and synthetic JSON responses; percent-escaping edge cases are not exercised by this VM suite.
- Rejection of missing/wrong local authentication, hostile Host/Origin headers and invalid tool arguments before upstream dispatch.
- Writes disabled on the default service; the separately opted-in fixture service still rejects a write without `confirm: true`.
- A confirmed synthetic JSON create, GET read-back, DELETE and verification of removal.
- Real multipart serialization/decoding and binary response encoding.
- HTTP 429 and redirects: sanitized tool errors, Retry-After, no automatic retries and no redirect following, checked against the upstream request journal.
- Clean service shutdown, zero exit status and closed listeners.

Only synthetic data and credentials are used. `example.xmatters.com` resolves to VM loopback; the fixture listens on loopback port 443. The test disables QEMU networking and test VLANs, then asserts that loopback is the VM's only network interface. No host ports are forwarded. The driver has a three-minute execution timeout, separate from dependency builds. Certificates are generated inside the VM at runtime, never checked in. TLS verification is enabled: `NODE_EXTRA_CA_CERTS` trusts only the fixture certificate in addition to Node's usual roots. There is no `NODE_TLS_REJECT_UNAUTHORIZED=0`, fetch preload or production URL-validation bypass.

## Maintain the Nix package

`flake.lock` pins Nixpkgs. `nix/package.nix` takes package/version information from the project and copies an explicit source allowlist, excluding credentials, `node_modules` and generated output.

Whenever `package-lock.json` changes, refresh the fixed-output npm hash and update `npmDepsHash` in `nix/package.nix`:

```sh
nix run --inputs-from . nixpkgs#prefetch-npm-deps -- package-lock.json
```

Then rebuild `.#e2e`. Do not insert a guessed hash or disable the fixed-output check.
