import { describe, expect, it } from "vitest";
import * as config from "../../src/config.js";

// Synthetic local-access credential, never a tenant credential.
const token = "test-only-local-access-token-0123456789";

describe("HTTP configuration", () => {
  it("accepts only bounded ports and request-body budgets", () => {
    const base = { XMATTERS_MCP_TOKEN: token };
    expect(
      config.loadHttpConfig({
        ...base,
        XMATTERS_MCP_PORT: "0",
        XMATTERS_MCP_MAX_REQUEST_BYTES: "1024",
      }),
    ).toEqual({ token, port: 0, maxRequestBytes: 1024 });
    expect(
      config.loadHttpConfig({ ...base, XMATTERS_MCP_PORT: "65535" }).port,
    ).toBe(65535);
    for (const port of ["-1", "65536", "1.5", "", " 3000", "Infinity"]) {
      expect(() =>
        config.loadHttpConfig({ ...base, XMATTERS_MCP_PORT: port }),
      ).toThrow(/XMATTERS_MCP_PORT/);
    }
    for (const bytes of ["0", "-1", "1.5", "104857601", "", "Infinity"]) {
      expect(() =>
        config.loadHttpConfig({
          ...base,
          XMATTERS_MCP_MAX_REQUEST_BYTES: bytes,
        }),
      ).toThrow(/XMATTERS_MCP_MAX_REQUEST_BYTES/);
    }
  });

  it("requires a bounded URL-safe local access token without echoing it", () => {
    expect(config.loadHttpConfig).toBeTypeOf("function");
    for (const value of [
      undefined,
      "",
      "short",
      " ".repeat(32),
      "x".repeat(257),
      `${token}\n`,
    ]) {
      expect(() =>
        config.loadHttpConfig({ XMATTERS_MCP_TOKEN: value }),
      ).toThrow(/XMATTERS_MCP_TOKEN/);
    }
    expect(config.loadHttpConfig({ XMATTERS_MCP_TOKEN: token })).toEqual({
      token,
      port: 3000,
      maxRequestBytes: 16777216,
    });
  });
});
