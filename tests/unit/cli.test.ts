import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { start } from "../../src/cli.js";

const env = {
  XMATTERS_BASE_URL: "https://example.xmatters.com",
  XMATTERS_API_KEY: "x-api-key-example",
  XMATTERS_API_SECRET: "test-only",
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
  it("wires configuration, actual catalog, client and transport without calling the tenant on startup", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = await start(env, st, fetch);
    const client = new Client({ name: "startup-test", version: "1.0.0" });
    try {
      await client.connect(ct);
      expect(
        (await client.listTools()).tools.some(
          (tool) => tool.name === "xmatters_get_people",
        ),
      ).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("rejects missing configuration before connecting transport", async () => {
    const [, st] = InMemoryTransport.createLinkedPair();
    await expect(start({}, st)).rejects.toThrow(/XMATTERS_BASE_URL/);
  });
});
