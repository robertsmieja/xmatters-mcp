import { request as httpRequest } from "node:http";
import * as nodeHttp from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMcpHandler,
  Server,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as http from "../../src/http.js";
import { loadHttpConfig } from "../../src/config.js";

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return { ...actual, createServer: vi.fn(actual.createServer) };
});

vi.mock("@modelcontextprotocol/node", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/node")>();
  return { ...actual, toNodeHandler: vi.fn(actual.toNodeHandler) };
});

vi.mock("@modelcontextprotocol/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/server")>();
  return {
    ...actual,
    createMcpHandler: vi.fn(
      (...args: Parameters<typeof actual.createMcpHandler>) => {
        const handler = actual.createMcpHandler(...args);
        vi.spyOn(handler, "close");
        return handler;
      },
    ),
  };
});

const token = "test-only-local-access-token-0123456789";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  try {
    await Promise.all(cleanup.splice(0).map((fn) => fn()));
  } finally {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  }
});

const message = {
  jsonrpc: "2.0",
  id: 1,
  method: "server/discover",
  params: {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
    },
  },
};
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "MCP-Protocol-Version": "2026-07-28",
  "Mcp-Method": "server/discover",
};
async function setup(
  overrides: NodeJS.ProcessEnv = {},
  factory: McpServerFactory = () => new Server({ name: "test", version: "1" }),
) {
  const server = await http.startHttp(
    factory,
    loadHttpConfig({
      XMATTERS_MCP_TOKEN: token,
      XMATTERS_MCP_PORT: "0",
      ...overrides,
    }),
  );
  cleanup.push(server.close);
  return server;
}

describe("local Streamable HTTP listener", () => {
  it.each(["{", "[]", " ".repeat(513)])(
    "omits an uncorrelatable SDK error ID rather than emitting null (%s)",
    async (body) => {
      const server = await setup({ XMATTERS_MCP_MAX_REQUEST_BYTES: "512" });
      const response = await fetch(server.url, {
        method: "POST",
        headers,
        body,
      });
      expect(response.status).toBe(body.length > 512 ? 413 : 400);
      const error = await response.json();
      expect(error).toMatchObject({
        jsonrpc: "2.0",
        error: { code: expect.any(Number) },
      });
      expect(error).not.toHaveProperty("id");
    },
  );

  it("does not spend admission tokens on failed authentication, paths or methods", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const server = await setup();
    for (let i = 0; i < 60; i++) {
      const invalid = await fetch(
        i % 3 === 0 ? `${server.url}?bad=1` : server.url,
        {
          method: i % 3 === 1 ? "GET" : "POST",
          headers: {
            ...headers,
            Authorization: i % 3 === 2 ? "Bearer wrong" : headers.Authorization,
          },
        },
      );
      expect(invalid.status).toBe([404, 405, 401][i % 3]);
      await invalid.arrayBuffer();
    }
    for (let i = 0; i < 60; i++) {
      const accepted = await fetch(server.url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      });
      expect(accepted.status).toBe(200);
      await accepted.arrayBuffer();
    }
  });

  it.each(["SDK", "adapter"])(
    "releases in-flight capacity after %s failures without leaking error details",
    async (layer) => {
      if (layer === "adapter")
        vi.mocked(toNodeHandler).mockReturnValueOnce(async () => {
          throw new Error(token);
        });
      const server = await setup({}, () => {
        throw new Error(token);
      });
      for (let i = 0; i < 9; i++) {
        const response = await fetch(server.url, {
          method: "POST",
          headers,
          body: JSON.stringify(message),
        });
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain(token);
      }
    },
  );

  it.each([`bEaReR ${token}`, `bearer ${token}`])(
    "treats the Bearer scheme as case-insensitive (%s)",
    async (Authorization) => {
      const server = await setup();
      const response = await fetch(server.url, {
        method: "POST",
        headers: { ...headers, Authorization },
        body: JSON.stringify(message),
      });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    },
  );

  it("compares the credential case-sensitively even at the same byte length", async () => {
    const factory = vi.fn(() => new Server({ name: "unused", version: "1" }));
    const server = await setup({}, factory);
    const response = await fetch(server.url, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${token.toUpperCase()}` },
      body: JSON.stringify(message),
    });
    expect(response.status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
    await response.arrayBuffer();
  });

  it("delegates invalid JSON, content type and legacy envelopes to the SDK", async () => {
    const factory = vi.fn(() => new Server({ name: "unused", version: "1" }));
    const server = await setup({}, factory);
    const cases = [
      {
        body: `{\"secret\":\"${token}\"`,
        type: "application/json",
        status: 400,
      },
      { body: JSON.stringify(message), type: "text/plain", status: 415 },
      {
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "old", version: "1" },
          },
        }),
        type: "application/json",
        status: 400,
      },
      {
        body: JSON.stringify([message]),
        type: "application/json",
        status: 400,
      },
    ];
    for (const { body, type, status } of cases) {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { ...headers, "Content-Type": type },
        body,
      });
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(text).not.toContain(token);
      expect(JSON.parse(text)).toMatchObject({
        jsonrpc: "2.0",
        error: { code: expect.any(Number), message: expect.any(String) },
      });
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it("leaves Accept negotiation to the SDK rather than adding a local 406 policy", async () => {
    const server = await setup();
    const response = await fetch(server.url, {
      method: "POST",
      headers: { ...headers, Accept: "text/plain" },
      body: JSON.stringify(message),
    });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });

  it("enforces the real HTTP parser header-size budget", async () => {
    const server = await setup();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        server.url,
        {
          method: "POST",
          headers: { ...headers, "X-Padding": "x".repeat(16 * 1024) },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(message));
    });
    expect(status).toBe(431);
  });

  it("accepts localhost only with this listener's exact port", async () => {
    const server = await setup();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        server.url,
        {
          method: "POST",
          headers: {
            ...headers,
            Host: `localhost:${new URL(server.url).port}`,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(message));
    });
    expect(status).toBe(200);
  });

  it("closes once across concurrent calls and allows the same port to be reused", async () => {
    const server = await setup();
    const handler = vi.mocked(createMcpHandler).mock.results.at(-1)!.value;
    const listener = vi
      .mocked(nodeHttp.createServer)
      .mock.results.at(-1)!.value;
    const first = server.close();
    expect(server.close()).toBe(first);
    await Promise.all([first, server.close()]);
    expect(handler.close).toHaveBeenCalledTimes(1);
    expect(listener.listening).toBe(false);
    const replacement = await setup({
      XMATTERS_MCP_PORT: new URL(server.url).port,
    });
    const response = await fetch(replacement.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });

  it("allows at most eight simultaneous requests and releases capacity on completion", async () => {
    let entered = 0;
    let release!: () => void;
    let reachedCapacity!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const full = new Promise<void>((resolve) => {
      reachedCapacity = resolve;
    });
    const server = await setup({}, async () => {
      if (++entered === 8) reachedCapacity();
      await gate;
      return new Server({ name: "test", version: "1" });
    });
    const post = (signal?: AbortSignal) =>
      fetch(server.url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal,
      });
    const pending = Array.from({ length: 8 }, () => post());
    try {
      await full;
      const denied = await post(AbortSignal.timeout(1_000));
      expect(denied.status).toBe(429);
      expect(denied.headers.get("retry-after")).toBe("1");
      await denied.arrayBuffer();
      expect(entered).toBe(8);
    } finally {
      release();
      await Promise.all(
        pending.map(async (promise) => {
          const response = await promise;
          await response.arrayBuffer();
        }),
      );
    }
    const next = await post();
    expect(next.status).toBe(200);
    await next.arrayBuffer();
  });

  it("limits the shared credential to a burst of 60 requests and refills one per monotonic second", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const server = await setup();
    const post = () =>
      fetch(server.url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      });
    for (let i = 0; i < 60; i++) {
      const response = await post();
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const denied = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...message,
        id: 99,
        params: {
          _meta: {
            ...message.params._meta,
            "io.modelcontextprotocol/clientInfo": {
              name: "different-client",
              version: "2",
            },
          },
        },
      }),
    });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("1");
    await denied.arrayBuffer();
    clock.mockReturnValue(999);
    const stillDenied = await post();
    expect(stillDenied.status).toBe(429);
    await stillDenied.arrayBuffer();
    clock.mockReturnValue(1_000);
    const refilled = await post();
    expect(refilled.status).toBe(200);
    await refilled.arrayBuffer();
    const depleted = await post();
    expect(depleted.status).toBe(429);
    await depleted.arrayBuffer();
    clock.mockReturnValue(120_000);
    for (let i = 0; i < 60; i++) {
      const response = await post();
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const capped = await post();
    expect(capped.status).toBe(429);
    await capped.arrayBuffer();
  });

  it("destroys a partial response on adapter failure instead of writing a second header block", async () => {
    vi.mocked(toNodeHandler).mockReturnValueOnce(async (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("partial");
      await new Promise<void>((resolve) => setImmediate(resolve));
      throw new Error(token);
    });
    const server = await setup();
    const response = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(1_000),
    });
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toMatchObject({ name: "TypeError" });
  });

  it("contains adapter rejections with a generic non-secret error response", async () => {
    vi.mocked(toNodeHandler).mockReturnValueOnce(async () => {
      throw new Error(token);
    });
    const server = await setup();
    const response = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(1_000),
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Internal Server Error" });
  });

  it("removes startup listeners and closes the handler if listen throws synchronously", async () => {
    const failure = new Error("synthetic listen failure");
    vi.spyOn(nodeHttp.Server.prototype, "listen").mockImplementationOnce(() => {
      throw failure;
    });
    await expect(setup()).rejects.toBe(failure);
    const handler = vi.mocked(createMcpHandler).mock.results.at(-1)!.value;
    const listener = vi
      .mocked(nodeHttp.createServer)
      .mock.results.at(-1)!.value;
    expect(handler.close).toHaveBeenCalledTimes(1);
    expect(listener.listenerCount("error")).toBe(0);
    expect(listener.listeners("listening")).toEqual(
      nodeHttp.createServer().listeners("listening"),
    );
  });

  it("closes the SDK handler and removes startup listeners if the port is occupied", async () => {
    const occupied = await setup();
    await expect(
      setup({ XMATTERS_MCP_PORT: new URL(occupied.url).port }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    const handler = vi.mocked(createMcpHandler).mock.results.at(-1)!.value;
    const listener = vi
      .mocked(nodeHttp.createServer)
      .mock.results.at(-1)!.value;
    expect(handler.close).toHaveBeenCalledTimes(1);
    expect(listener.listening).toBe(false);
    expect(listener.listenerCount("error")).toBe(0);
    // node:http keeps its own connection-tracking listener; only ours must go.
    const baseline = nodeHttp.createServer();
    expect(listener.listeners("listening")).toEqual(
      baseline.listeners("listening"),
    );
  });

  it.each(["Authorization", "Host", "Origin"])(
    "rejects duplicate %s wire headers, even when the runtime would discard them",
    async (name) => {
      const server = await setup();
      const wireHeaders = [
        "Host",
        new URL(server.url).host,
        ...Object.entries(headers).flat(),
      ];
      if (name === "Origin") wireHeaders.push("Origin", "null");
      wireHeaders.push(
        name.toLowerCase(),
        name === "Authorization" ? "Bearer wrong" : "evil.invalid",
      );
      const status = await new Promise<number | undefined>(
        (resolve, reject) => {
          const req = httpRequest(
            server.url,
            { method: "POST", headers: wireHeaders },
            (res) => {
              res.resume();
              res.on("end", () => resolve(res.statusCode));
            },
          );
          req.on("error", reject);
          req.end(JSON.stringify(message));
        },
      );
      expect(status).toBe(name === "Origin" ? 403 : 400);
    },
  );

  it("sets explicit header, request, keepalive and parser byte budgets", async () => {
    const created = vi.spyOn(nodeHttp, "createServer");
    try {
      await setup();
      expect(created).toHaveBeenCalledWith(
        {
          headersTimeout: 10_000,
          requestTimeout: 30_000,
          connectionsCheckingInterval: 1_000,
          keepAliveTimeout: 5_000,
          maxHeaderSize: 16 * 1024,
        },
        expect.any(Function),
      );
      expect(created.mock.results[0]?.value).toMatchObject({
        headersTimeout: 10_000,
        requestTimeout: 30_000,
        keepAliveTimeout: 5_000,
        maxHeaderSize: 16 * 1024,
      });
    } finally {
      created.mockRestore();
    }
  });

  it("rejects an oversized declared body before waiting for upload", async () => {
    const server = await setup({ XMATTERS_MCP_MAX_REQUEST_BYTES: "512" });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        server.url,
        { method: "POST", headers: { ...headers, "Content-Length": "513" } },
        (res) => {
          res.resume();
          res.on("end", () => {
            resolve(res.statusCode);
            req.destroy();
          });
        },
      );
      req.on("error", reject);
      req.flushHeaders();
    });
    expect(status).toBe(413);
  });

  it("rejects an observed chunked body as soon as its byte budget is exceeded", async () => {
    const server = await setup({ XMATTERS_MCP_MAX_REQUEST_BYTES: "512" });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        server.url,
        { method: "POST", headers },
        (res) => {
          res.resume();
          res.on("end", () => {
            resolve(res.statusCode);
            req.destroy();
          });
        },
      );
      req.on("error", reject);
      req.write(" ".repeat(511));
      // Two UTF-8 bytes cross the limit, without ending the chunked request.
      setImmediate(() => req.write("é"));
    });
    expect(status).toBe(413);
  });

  it.each([0, 1])(
    "measures UTF-8 body bytes at the exact limit (overflow %s)",
    async (overflow) => {
      const body = JSON.stringify({
        ...message,
        params: { ...message.params, padding: "é" },
      });
      const server = await setup({
        XMATTERS_MCP_MAX_REQUEST_BYTES: String(
          Buffer.byteLength(body) - overflow,
        ),
      });
      const response = await fetch(server.url, {
        method: "POST",
        headers,
        body,
      });
      expect(response.status).toBe(overflow ? 413 : 200);
      await response.arrayBuffer();
    },
  );

  it("applies a configured body limit above the SDK's 4 MiB defaults at both layers", async () => {
    const server = await setup({
      XMATTERS_MCP_MAX_REQUEST_BYTES: String(6 * 1024 * 1024),
    });
    const body = JSON.stringify({
      ...message,
      params: { ...message.params, padding: "x".repeat(5 * 1024 * 1024) },
    });
    const response = await fetch(server.url, { method: "POST", headers, body });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 1,
      result: { supportedVersions: ["2026-07-28"] },
    });
  });

  it.each(["GET", "DELETE", "HEAD", "OPTIONS", "PUT", "PATCH"])(
    "rejects %s with Allow: POST",
    async (method) => {
      const server = await setup();
      const response = await fetch(server.url, { method, headers });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      await response.arrayBuffer();
    },
  );

  it.each([
    "/",
    "/sse",
    "/messages",
    "/mcp/",
    "/mcp?access_token=ignored",
    "/mcp?",
    "/%6dcp",
    "//mcp",
    "/other/../mcp",
    "http://user:password@localhost/mcp",
  ])("accepts only the exact request target /mcp, not %s", async (path) => {
    const server = await setup();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        server.url,
        { method: "POST", path, headers },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(message));
    });
    expect(status).toBe(404);
  });

  it.each([
    undefined,
    "Bearer wrong",
    `Basic ${token}`,
    `Bearer ${token}suffix`,
  ])(
    "rejects unauthorized requests before dispatch (%s)",
    async (authorization) => {
      const server = await setup();
      const requestHeaders = new Headers(headers);
      if (authorization === undefined) requestHeaders.delete("Authorization");
      else requestHeaders.set("Authorization", authorization);
      const response = await fetch(server.url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(message),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
      expect(await response.text()).not.toContain(token);
    },
  );

  it.each([
    "https://evil.invalid",
    "null",
    "",
    "http://127.0.0.1:3000",
    "not-an-origin",
  ])("forbids every browser Origin, including %s", async (Origin) => {
    const server = await setup();
    const response = await fetch(server.url, {
      method: "POST",
      headers: { ...headers, Origin },
      body: JSON.stringify(message),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each([
    "evil.invalid",
    "127.0.0.1.evil.invalid",
    "127.0.0.1:1",
    "localhost:1",
  ])("rejects a rebound or wrong-port Host %s", async (Host) => {
    const server = await setup();
    // fetch may discard Host overrides; use node:http to exercise actual wire bytes.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        server.url,
        { method: "POST", headers: { ...headers, Host } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(message));
    });
    expect(status).toBe(403);
  });

  it("serves a modern request on a loopback endpoint and closes cleanly", async () => {
    const server = await setup();
    expect(new URL(server.url).hostname).toBe("127.0.0.1");
    const response = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(await response.json()).toMatchObject({
      id: 1,
      result: {
        supportedVersions: ["2026-07-28"],
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "test" } },
      },
    });
    await server.close();
    await expect(fetch(server.url)).rejects.toThrow();
  });
});
