import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { operations } from "../../src/index.js";
import {
  fixtureKey,
  fixtureSecret,
  fixtureToken,
  makeClient,
  missingConfig,
  protocolVersion,
  requestOptions,
  root,
  rpcHeaders,
  rpcMessage,
  runtime,
  startCli,
  wireRequest,
  type RunningCli,
} from "../helpers/http-process.js";

const entrypoints = [
  { name: "built executable", entrypoint: join(root, "dist/cli.js") },
  ...(runtime === "bun"
    ? [
        {
          name: "TypeScript source entrypoint",
          entrypoint: join(root, "src/cli.ts"),
        },
      ]
    : []),
];

describe.each(entrypoints)(`${runtime} HTTP $name`, ({ entrypoint }) => {
  let server: RunningCli | undefined;
  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running) {
      expect(await running.stop()).toEqual({ code: 0, signal: null });
      expect(running.stdout()).toBe("");
      expect(running.stderr()).toBe(
        `xmatters-mcp: listening on ${running.url}\n`,
      );
    }
  }, 15000);

  it("discovers a modern server, all 179 tools, mocked GET, read-only protection, invalid arguments and catalog resources", async () => {
    server = await startCli({ entrypoint });
    const { client, transport } = makeClient(server.url);
    try {
      await client.connect(transport, requestOptions);
      expect(client.getProtocolEra()).toBe("modern");
      expect(client.getServerVersion()).toMatchObject({
        name: "xmatters-mcp",
        version: "0.2.0",
      });
      expect(transport.sessionId).toBeUndefined();
      const listed = await client.listTools(undefined, requestOptions);
      expect(listed.tools).toHaveLength(179);
      expect(listed.tools.map((tool) => tool.name)).toEqual(
        operations.map((op) => op.id),
      );
      const result = await client.callTool(
        {
          name: "xmatters_get_people",
          arguments: { query: { limit: 1 } },
        },
        requestOptions,
      );
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual({
        data: { data: [{ id: "synthetic-person" }], count: 1, total: 1 },
      });
      const blocked = await client.callTool(
        {
          name: "xmatters_create_a_person",
          arguments: { body: { targetName: "never-created" }, confirm: true },
        },
        requestOptions,
      );
      expect(blocked.isError).toBe(true);
      expect(blocked.structuredContent).toEqual({
        error:
          "Writes are disabled. The operator must set XMATTERS_ALLOW_WRITES=true; every write also requires confirm:true.",
      });
      const invalid = await client.callTool(
        {
          name: "xmatters_get_people",
          arguments: { url: "https://attacker.invalid" },
        },
        requestOptions,
      );
      expect(invalid.isError).toBe(true);
      expect(invalid.structuredContent).toEqual({
        error: "Invalid arguments; see the tool inputSchema.",
      });
      const resource = await client.readResource(
        {
          uri: "xmatters://api/catalog",
        },
        requestOptions,
      );
      const text = resource.contents[0];
      expect(
        text && "text" in text
          ? JSON.parse(text.text as string).operationCount
          : 0,
      ).toBe(operations.length);
    } finally {
      await client.close();
    }
    expect(await server.stop()).toEqual({ code: 0, signal: null });
    expect(server.stdout()).toBe("");
    expect(server.stderr()).toBe(`xmatters-mcp: listening on ${server.url}\n`);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "closes its listener cleanly on %s without stdout or credential leakage",
    async (signal) => {
      server = await startCli({ entrypoint });
      expect(await server.stop(signal)).toEqual({ code: 0, signal: null });
      expect(server.stdout()).toBe("");
      expect(server.stderr()).toBe(
        `xmatters-mcp: listening on ${server.url}\n`,
      );
      await expect(wireRequest(server.url)).rejects.toThrow();
    },
  );

  it("serves tools before discovery, preserves id zero and advertises modern-only identity without creating a session", async () => {
    server = await startCli({ entrypoint });
    const listed = await wireRequest(server.url, {
      headers: rpcHeaders("tools/list"),
      body: JSON.stringify(rpcMessage("tools/list", {}, 0)),
    });
    expect(listed.status).toBe(200);
    expect(listed.headers["mcp-session-id"]).toBeUndefined();
    expect(listed.headers["set-cookie"]).toBeUndefined();
    expect(listed.headers["cache-control"]).toContain("no-store");
    const body = JSON.parse(listed.body);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 0,
      result: { resultType: "complete", ttlMs: 0, cacheScope: "private" },
    });
    expect(body.result.tools).toHaveLength(179);
    expect(
      body.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(operations.map((op) => op.id));
    // A separate, non-keepalive HTTP connection has everything it needs.
    const discovered = await wireRequest(server.url);
    expect(discovered.status).toBe(200);
    expect(discovered.headers["mcp-session-id"]).toBeUndefined();
    expect(JSON.parse(discovered.body)).toMatchObject({
      id: 1,
      result: {
        resultType: "complete",
        supportedVersions: [protocolVersion],
        capabilities: { tools: {}, resources: {} },
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "xmatters-mcp",
            version: "0.2.0",
          },
        },
      },
    });
  });

  it.each([
    ["missing", undefined],
    ["wrong bearer", `Bearer ${"x".repeat(fixtureToken.length)}`],
    [
      "upstream credentials",
      `Basic ${Buffer.from(`${fixtureKey}:${fixtureSecret}`).toString("base64")}`,
    ],
  ])(
    "rejects %s authentication with 401 before dispatch",
    async (_, authorization) => {
      server = await startCli({ entrypoint });
      const headers = rpcHeaders();
      if (authorization === undefined) delete headers.Authorization;
      else headers.Authorization = authorization;
      const response = await wireRequest(server.url, { headers });
      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toContain("Bearer");
      expect(response.headers["mcp-session-id"]).toBeUndefined();
      for (const secret of [fixtureToken, fixtureKey, fixtureSecret]) {
        expect(response.body).not.toContain(secret);
        expect(server.stderr()).not.toContain(secret);
      }
    },
  );

  it.each(["https://attacker.invalid", "null", "", "http://127.0.0.1:3000"])(
    "rejects browser Origin %s with 403",
    async (Origin) => {
      server = await startCli({ entrypoint });
      const response = await wireRequest(server.url, {
        headers: { ...rpcHeaders(), Origin },
      });
      expect(response.status).toBe(403);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    },
  );

  it.each([
    "attacker.invalid",
    "127.0.0.1.attacker.invalid",
    "127.0.0.1:1",
    "localhost:1",
  ])(
    "rejects rebound or wrong-port Host %s with 403 over actual HTTP wire bytes",
    async (Host) => {
      server = await startCli({ entrypoint });
      const response = await wireRequest(server.url, {
        headers: { ...rpcHeaders(), Host },
      });
      expect(response.status).toBe(403);
    },
  );

  it.each(["GET", "DELETE", "HEAD", "OPTIONS", "PUT", "PATCH"])(
    "rejects unsupported HTTP method %s with 405",
    async (method) => {
      server = await startCli({ entrypoint });
      const response = await wireRequest(server.url, { method, body: "" });
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("POST");
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    },
  );

  it.each(["/", "/sse", "/messages", "/mcp/", "/mcp?access_token=ignored"])(
    "rejects non-endpoint target %s with 404",
    async (path) => {
      server = await startCli({ entrypoint });
      expect((await wireRequest(server.url, { path })).status).toBe(404);
    },
  );

  it.each([
    "_meta",
    "io.modelcontextprotocol/protocolVersion",
    "io.modelcontextprotocol/clientCapabilities",
  ])("rejects missing required request metadata %s with 400", async (field) => {
    server = await startCli({ entrypoint });
    const message = rpcMessage();
    const target = field === "_meta" ? message.params : message.params._meta;
    delete (target as Record<string, unknown>)[field];
    const response = await wireRequest(server.url, {
      body: JSON.stringify(message),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toHaveProperty("error.code");
  });

  it("allows absent optional clientInfo", async () => {
    server = await startCli({ entrypoint });
    const message = rpcMessage();
    delete (message.params._meta as Record<string, unknown>)[
      "io.modelcontextprotocol/clientInfo"
    ];
    const response = await wireRequest(server.url, {
      body: JSON.stringify(message),
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).result.supportedVersions).toEqual([
      protocolVersion,
    ]);
  });

  it.each(["MCP-Protocol-Version", "Mcp-Method"])(
    "rejects missing required standard header %s with 400",
    async (header) => {
      server = await startCli({ entrypoint });
      const headers = rpcHeaders();
      delete headers[header];
      const response = await wireRequest(server.url, { headers });
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toHaveProperty("error.code");
    },
  );

  it.each([
    ["MCP-Protocol-Version", "2026-07-29"],
    ["Mcp-Method", "tools/list"],
  ])("rejects header/body mismatch in %s with 400", async (header, value) => {
    server = await startCli({ entrypoint });
    const response = await wireRequest(server.url, {
      headers: { ...rpcHeaders(), [header]: value },
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toHaveProperty("error.code");
  });

  it.each([undefined, "xmatters_create_a_person"])(
    "rejects missing or mismatching Mcp-Name %s with 400",
    async (name) => {
      server = await startCli({ entrypoint });
      const headers = rpcHeaders("tools/call");
      if (name !== undefined) headers["Mcp-Name"] = name;
      const response = await wireRequest(server.url, {
        headers,
        body: JSON.stringify(
          rpcMessage("tools/call", {
            name: "xmatters_get_people",
            arguments: { query: { limit: 1 } },
          }),
        ),
      });
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toHaveProperty("error.code");
    },
  );

  it("rejects an unsupported protocol revision with 400 and the supported revision", async () => {
    server = await startCli({ entrypoint });
    const message = rpcMessage();
    message.params._meta["io.modelcontextprotocol/protocolVersion"] =
      "2099-01-01";
    const response = await wireRequest(server.url, {
      headers: { ...rpcHeaders(), "MCP-Protocol-Version": "2099-01-01" },
      body: JSON.stringify(message),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: { code: -32022, data: { supported: [protocolVersion] } },
    });
  });

  it("rejects an unknown RPC method with 404", async () => {
    server = await startCli({ entrypoint });
    const response = await wireRequest(server.url, {
      headers: rpcHeaders("fixture/unknown"),
      body: JSON.stringify(rpcMessage("fixture/unknown")),
    });
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toMatchObject({
      id: 1,
      error: { code: -32601 },
    });
  });

  it("rejects a legacy initialize request instead of silently falling back", async () => {
    server = await startCli({ entrypoint });
    const headers = rpcHeaders();
    delete headers["MCP-Protocol-Version"];
    delete headers["Mcp-Method"];
    const response = await wireRequest(server.url, {
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-test", version: "1" },
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toHaveProperty("error.code");
    expect(response.headers["mcp-session-id"]).toBeUndefined();
  });

  it.each(["{", JSON.stringify([rpcMessage()])])(
    "rejects malformed JSON or batch requests (%s) with 400",
    async (body) => {
      server = await startCli({ entrypoint });
      const response = await wireRequest(server.url, { body });
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toHaveProperty("error.code");
      expect(JSON.parse(response.body)).not.toHaveProperty("id");
    },
  );

  it("fails closed with missing configuration and no stdout or secret leakage", () => {
    const child = missingConfig({ entrypoint });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr).toBe(
      "xmatters-mcp: startup failed; check XMATTERS_* configuration and transport. No credentials are logged.\n",
    );
  });
});
