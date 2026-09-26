import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  createMcpHandler,
  ProtocolErrorCode,
  type JSONRPCRequest,
} from "@modelcontextprotocol/server";
import { createServer } from "../../src/server.js";
import * as toolOperations from "../../src/tools.js";
import type { Operation } from "../../src/tools.js";

const operation: Operation = {
  id: "xmatters_get_people",
  title: "Get people",
  group: "PEOPLE",
  method: "GET",
  path: "/api/xm/1/people",
  docsUrl: "https://help.xmatters.com/xmapi/#get-people",
  request: "none",
  response: "json",
  pathParams: [],
  queryParams: ["offset", "limit"],
  bodyParams: [],
  requiredQueryParams: [],
  requiredBodyParams: [],
};
const protocolVersion = "2026-07-28";
const endpoint = new URL("http://test.local/mcp");
const catalogUri = "xmatters://api/catalog";
const clientInfo = { name: "test-client", version: "1.0.0" };
const serverInfo = { name: "xmatters-mcp", version: "0.2.0" };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  try {
    await Promise.all(cleanup.splice(0).map((close) => close()));
  } finally {
    vi.restoreAllMocks();
  }
});
function fixture(
  operations: readonly Operation[] = [operation],
  allowWrites?: boolean,
) {
  const request = vi.fn().mockResolvedValue({ data: [{ id: "one" }] });
  const factory = vi.fn(() =>
    createServer({ client: { request }, operations, allowWrites }),
  );
  const handler = createMcpHandler(factory, {
    legacy: "reject",
    responseMode: "auto",
  });
  cleanup.push(() => handler.close());
  return { request, handler, factory };
}
async function setup(
  operations: readonly Operation[] = [operation],
  allowWrites?: boolean,
) {
  const context = fixture(operations, allowWrites);
  const client = new Client(clientInfo, {
    versionNegotiation: { mode: { pin: protocolVersion } },
  });
  const exchanges: {
    request: Request;
    message: JSONRPCRequest;
    response: Response;
    body: unknown;
  }[] = [];
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const message = (await request.clone().json()) as JSONRPCRequest;
      const response = await context.handler.fetch(request);
      exchanges.push({
        request,
        message,
        response,
        body: await response.clone().json(),
      });
      return response;
    },
  });
  cleanup.push(() => client.close());
  await client.connect(transport);
  return { ...context, client, transport, exchanges };
}
function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  version = protocolVersion,
): Request {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": version,
    "Mcp-Method": method,
  });
  const name = params.name ?? params.uri;
  if (typeof name === "string") headers.set("Mcp-Name", name);
  return new Request(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "wire-test",
      method,
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": version,
          "io.modelcontextprotocol/clientInfo": clientInfo,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
        ...params,
      },
    }),
  });
}

describe("MCP server", () => {
  it("propagates HTTP cancellation through the tool bridge to its executor", async () => {
    const { handler, request } = fixture();
    let resolve!: (value: unknown) => void;
    request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const controller = new AbortController();
    const response = handler.fetch(
      new Request(
        modernRequest("tools/call", { name: operation.id, arguments: {} }),
        { signal: controller.signal },
      ),
    );
    try {
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
      controller.abort(new Error("private cancellation reason"));
      await response;
      expect(request.mock.calls[0]![0].signal).toMatchObject({ aborted: true });
    } finally {
      resolve({ data: [] });
      await response;
    }
  });
  it("builds tool schemas lazily once across per-request server instances", async () => {
    const buildTool = vi.spyOn(toolOperations, "buildTool");
    const operations = [
      { ...operation, id: "z_last_alphabetically" },
      { ...operation, id: "a_first_alphabetically" },
    ];
    const { client, request } = await setup(operations);
    expect(buildTool).not.toHaveBeenCalled();
    const first = await client.listTools();
    expect(first.tools.map((tool) => tool.name)).toEqual(
      operations.map((item) => item.id),
    );
    await client.readResource({ uri: catalogUri });
    expect(await client.listTools()).toEqual(first);
    expect(buildTool).toHaveBeenCalledTimes(operations.length);
    expect(request).not.toHaveBeenCalled();
  });
  it("refreshes cached schemas when the supplied catalog changes", async () => {
    const mutableOperation = structuredClone(operation);
    const operations = [mutableOperation];
    const { client } = await setup(operations);
    const original = await client.listTools();
    mutableOperation.title = "Updated people query";
    mutableOperation.requiredQueryParams.push("limit");
    operations.push({ ...operation, id: "xmatters_get_other_people" });
    const updated = await client.listTools();
    expect(updated.tools.map((tool) => tool.name)).toEqual(
      operations.map((item) => item.id),
    );
    expect(updated.tools[0]).toMatchObject({
      title: "Updated people query",
      inputSchema: {
        required: ["query"],
        properties: { query: { required: ["limit"] } },
      },
    });
    expect(original.tools).toHaveLength(1);
    expect(original.tools[0]?.title).toBe(operation.title);
  });
  it("dispatches through tools/call and returns structured API data", async () => {
    const { client, request } = await setup();
    const response = await client.callTool({
      name: operation.id,
      arguments: { query: { limit: 1 } },
    });
    expect(response.structuredContent).toEqual({
      data: { data: [{ id: "one" }] },
    });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/xm/1/people",
      query: { limit: 1 },
      responseType: "json",
      signal: expect.any(AbortSignal),
    });
  });
  it("returns a protocol error for unknown tool names without making a request", async () => {
    const { client, request } = await setup();
    await expect(
      client.callTool({ name: "not_a_tool", arguments: {} }),
    ).rejects.toMatchObject({
      code: ProtocolErrorCode.InvalidParams,
      message: expect.stringContaining("Unknown tool"),
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("returns tool-level validation errors and applies read-only mode by default", async () => {
    const mutation: Operation = {
      ...operation,
      id: "xmatters_create_person",
      method: "POST",
      request: "json",
    };
    const { client, request } = await setup([mutation]);
    const result = await client.callTool({
      name: mutation.id,
      arguments: { body: {}, confirm: true },
    });
    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
  it("makes explicitly enabled and confirmed mutations available", async () => {
    const mutation: Operation = {
      ...operation,
      id: "xmatters_create_person",
      method: "POST",
      request: "json",
    };
    const { client, request } = await setup([mutation], true);
    expect(
      (
        await client.callTool({
          name: mutation.id,
          arguments: { body: {}, confirm: true },
        })
      ).isError,
    ).not.toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });
  it("does not share clients or write permissions with a cached catalog", async () => {
    const mutation: Operation = {
      ...operation,
      id: "xmatters_create_person",
      method: "POST",
      request: "json",
    };
    const operations = [mutation];
    const writable = await setup(operations, true);
    const readOnly = await setup(operations);
    expect(await readOnly.client.listTools()).toEqual(
      await writable.client.listTools(),
    );
    const call = { name: mutation.id, arguments: { body: {}, confirm: true } };
    expect((await writable.client.callTool(call)).isError).toBe(false);
    expect((await readOnly.client.callTool(call)).isError).toBe(true);
    expect(writable.request).toHaveBeenCalledOnce();
    expect(readOnly.request).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { body: {} },
    { body: {}, confirm: false },
    { body: {}, confirm: true, unexpected: "not allowed" },
  ])(
    "keeps invalid or unconfirmed mutations as tool-level errors: %j",
    async (arguments_) => {
      const mutation: Operation = {
        ...operation,
        id: "xmatters_create_person",
        method: "POST",
        request: "json",
      };
      const { client, request } = await setup([mutation], true);
      const result = await client.callTool({
        name: mutation.id,
        arguments: arguments_,
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        error: "Invalid arguments; see the tool inputSchema.",
      });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("exposes the full operation manifest as a read-only MCP resource", async () => {
    const { client, request } = await setup();
    expect((await client.listResources()).resources).toEqual([
      {
        uri: catalogUri,
        name: "xMatters REST API operation catalog",
        mimeType: "application/json",
        description:
          "Published REST endpoints, input encodings and authoritative documentation links. No credentials.",
      },
    ]);
    const data = await client.readResource({ uri: catalogUri });
    const item = data.contents[0];
    expect(item).toMatchObject({
      uri: catalogUri,
      mimeType: "application/json",
    });
    expect(
      item && "text" in item ? JSON.parse(item.text as string) : null,
    ).toEqual({
      source: "https://help.xmatters.com/xmapi/",
      scope: "Published REST API; not SOAP or private UI APIs",
      operationCount: 1,
      operations: [operation],
    });
    await expect(
      client.readResource({ uri: "file:///etc/passwd" }),
    ).rejects.toMatchObject({
      code: ProtocolErrorCode.InvalidParams,
      message: expect.stringContaining("Unknown resource"),
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects duplicate tool IDs instead of silently overwriting a route", () => {
    expect(() =>
      createServer({
        client: { request: vi.fn() },
        operations: [operation, operation],
      }),
    ).toThrow(/Duplicate/);
  });
  it("discovers the server using the pinned 2026-07-28 protocol without initialize", async () => {
    const { client, transport, exchanges } = await setup();
    expect(client.getProtocolEra()).toBe("modern");
    expect(client.getDiscoverResult()).toMatchObject({
      supportedVersions: [protocolVersion],
      capabilities: { tools: {}, resources: {} },
    });
    expect(client.getServerVersion()).toEqual(serverInfo);
    expect(exchanges.map(({ message }) => message.method)).toEqual([
      "server/discover",
    ]);
    expect(exchanges[0]?.body).toEqual({
      jsonrpc: "2.0",
      id: exchanges[0]?.message.id,
      result: {
        resultType: "complete",
        supportedVersions: [protocolVersion],
        capabilities: { tools: {}, resources: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
        ttlMs: 0,
        cacheScope: "private",
      },
    });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      operation.id,
    ]);
    expect(exchanges.map(({ message }) => message.method)).toEqual([
      "server/discover",
      "tools/list",
    ]);
    expect(transport.sessionId).toBeUndefined();
  });
  it("carries metadata, mirrored headers, and server identity on every modern exchange", async () => {
    const { client, exchanges, factory } = await setup();
    await client.listTools();
    await client.listResources();
    await client.readResource({ uri: catalogUri });
    const result = await client.callTool({ name: operation.id, arguments: {} });
    expect(result).not.toHaveProperty("resultType");
    expect(exchanges.map(({ message }) => message.method)).toEqual([
      "server/discover",
      "tools/list",
      "resources/list",
      "resources/read",
      "tools/call",
    ]);
    expect(factory).toHaveBeenCalledTimes(exchanges.length);
    for (const { request, message, response, body } of exchanges) {
      expect(request.method).toBe("POST");
      expect(request.headers.get("MCP-Protocol-Version")).toBe(protocolVersion);
      expect(request.headers.get("Mcp-Method")).toBe(message.method);
      expect(request.headers.get("Mcp-Session-Id")).toBeNull();
      expect(message.params?._meta).toEqual({
        "io.modelcontextprotocol/protocolVersion": protocolVersion,
        "io.modelcontextprotocol/clientInfo": clientInfo,
        "io.modelcontextprotocol/clientCapabilities": {},
      });
      if (message.method === "tools/call") {
        expect(request.headers.get("Mcp-Name")).toBe(operation.id);
      } else if (message.method === "resources/read") {
        expect(request.headers.get("Mcp-Name")).toBe(catalogUri);
      }
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("Mcp-Session-Id")).toBeNull();
      expect(body).toMatchObject({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          resultType: "complete",
          _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
        },
      });
      if (message.method !== "tools/call") {
        expect(body).toMatchObject({
          result: { ttlMs: 0, cacheScope: "private" },
        });
      } else {
        expect(body).not.toHaveProperty("result.ttlMs");
        expect(body).not.toHaveProperty("result.cacheScope");
      }
    }
  });
  it("serves a tool call as the first request without discovery or initialization", async () => {
    const { handler, request, factory } = fixture();
    const response = await handler.fetch(
      modernRequest("tools/call", { name: operation.id, arguments: {} }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "wire-test",
      result: {
        resultType: "complete",
        isError: false,
        structuredContent: { data: { data: [{ id: "one" }] } },
      },
    });
    expect(request).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledOnce();
  });
});

describe("2026-07-28 wire validation", () => {
  it.each(["not/a/method", "initialize", "ping"])(
    "returns HTTP 404 and MethodNotFound for %s",
    async (method) => {
      const { handler, request } = fixture();
      const response = await handler.fetch(modernRequest(method));
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        jsonrpc: "2.0",
        id: "wire-test",
        error: { code: ProtocolErrorCode.MethodNotFound },
      });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it.each(["2099-01-01", "2025-11-25"])(
    "rejects an unsupported envelope version %s with supported revisions",
    async (version) => {
      const { handler, request } = fixture();
      const response = await handler.fetch(
        modernRequest("tools/list", {}, version),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        jsonrpc: "2.0",
        id: "wire-test",
        error: {
          code: ProtocolErrorCode.UnsupportedProtocolVersion,
          data: { requested: version, supported: [protocolVersion] },
        },
      });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("rejects a legacy initialize instead of silently serving a legacy session", async () => {
    const { handler, request, factory } = fixture();
    const response = await handler.fetch(
      new Request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "legacy",
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            clientInfo,
            capabilities: {},
          },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "legacy",
      error: {
        code: ProtocolErrorCode.UnsupportedProtocolVersion,
        data: { supported: [protocolVersion] },
      },
    });
    expect(response.headers.get("Mcp-Session-Id")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });
  it.each([
    ["MCP-Protocol-Version", undefined],
    ["MCP-Protocol-Version", "2025-11-25"],
    ["Mcp-Method", undefined],
    ["Mcp-Method", "resources/read"],
    ["Mcp-Name", undefined],
    ["Mcp-Name", "a_different_tool"],
  ] as const)(
    "rejects tools/call header %s=%s before calling xMatters",
    async (header, value) => {
      const { handler, request } = fixture();
      const inbound = modernRequest("tools/call", {
        name: operation.id,
        arguments: {},
      });
      if (value === undefined) inbound.headers.delete(header);
      else inbound.headers.set(header, value);
      const response = await handler.fetch(inbound);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        jsonrpc: "2.0",
        id: "wire-test",
        error: { code: -32020 },
      });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("rejects a resource URI header that disagrees with the body", async () => {
    const { handler, request } = fixture();
    const inbound = modernRequest("resources/read", { uri: catalogUri });
    inbound.headers.set("Mcp-Name", "file:///etc/passwd");
    const response = await handler.fetch(inbound);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: -32020 },
    });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { "io.modelcontextprotocol/protocolVersion": protocolVersion },
    {
      "io.modelcontextprotocol/protocolVersion": protocolVersion,
      "io.modelcontextprotocol/clientCapabilities": "invalid",
    },
    {
      "io.modelcontextprotocol/protocolVersion": protocolVersion,
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": "invalid",
    },
  ])("rejects missing or malformed required metadata: %j", async (_meta) => {
    const { handler, request } = fixture();
    const response = await handler.fetch(
      modernRequest("tools/list", { _meta }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "wire-test",
      error: { code: ProtocolErrorCode.InvalidParams },
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("accepts omitted clientInfo because identity is recommended, not required", async () => {
    const { handler } = fixture();
    const response = await handler.fetch(
      modernRequest("tools/list", {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocolVersion,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { tools: [expect.objectContaining({ name: operation.id })] },
    });
  });
});
