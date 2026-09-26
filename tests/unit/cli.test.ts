import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { runCli, start } from "../../src/cli.js";

const env = {
  XMATTERS_BASE_URL: "https://example.xmatters.com",
  XMATTERS_API_KEY: "x-api-key-example",
  XMATTERS_API_SECRET: "test-only",
  XMATTERS_MCP_TOKEN: "test-only-local-access-token-0123456789",
  XMATTERS_MCP_PORT: "0",
};

describe("startup", () => {
  it("reports direct-entrypoint startup failure only on stderr and sets a failing exit status", async () => {
    const argv = process.argv;
    const exitCode = process.exitCode;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.argv = [
        process.execPath,
        fileURLToPath(new URL("../../src/cli.ts", import.meta.url)),
      ];
      vi.stubEnv("XMATTERS_BASE_URL", "");
      vi.resetModules();
      await import("../../src/cli.js");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("startup failed"),
      );
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      vi.unstubAllEnvs();
      error.mockRestore();
    }
  });

  it("wires the catalog into authenticated modern HTTP without calling the tenant on startup", async () => {
    const tenantFetch = vi.fn<typeof globalThis.fetch>();
    const server = await start(env, tenantFetch);
    const client = new Client(
      { name: "startup-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: {
            headers: { Authorization: `Bearer ${env.XMATTERS_MCP_TOKEN}` },
          },
        }),
      );
      expect(client.getProtocolEra()).toBe("modern");
      expect(
        (await client.listTools()).tools.some(
          (tool) => tool.name === "xmatters_get_people",
        ),
      ).toBe(true);
      expect(tenantFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("prints only the listening endpoint and handles signals without leaking listeners", async () => {
    const before = new Set(process.listeners("SIGTERM"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = await runCli(env, []);
    try {
      expect(error).toHaveBeenCalledWith(
        `xmatters-mcp: listening on ${server.url}`,
      );
      const signal = process.listeners("SIGTERM").find((fn) => !before.has(fn));
      expect(signal).toBeTypeOf("function");
      signal!("SIGTERM");
      await server.close();
      expect(new Set(process.listeners("SIGTERM"))).toEqual(before);
      await expect(fetch(server.url)).rejects.toThrow();
    } finally {
      await server.close();
      error.mockRestore();
    }
  });

  it("rejects obsolete transport flags instead of silently using another transport", async () => {
    await expect(runCli(env, ["--stdio"])).rejects.toThrow(/HTTP-only/);
  });

  it("rejects missing configuration before opening a listener", async () => {
    await expect(start({})).rejects.toThrow(/XMATTERS_BASE_URL/);
  });
});
