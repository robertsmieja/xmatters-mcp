import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";

const base = {
  XMATTERS_BASE_URL: "https://example.xmatters.com",
  XMATTERS_API_KEY: "x-api-key-example",
  XMATTERS_API_SECRET: "test-only",
};

describe("loadConfig", () => {
  it.each([
    { XMATTERS_BASE_URL: "" },
    { XMATTERS_API_KEY: "" },
    { XMATTERS_API_SECRET: "" },
    { XMATTERS_API_KEY: "raw-key" },
    { XMATTERS_ALLOW_WRITES: "yes" },
    { XMATTERS_TIMEOUT_MS: "0" },
    { XMATTERS_TIMEOUT_MS: "1.5" },
    { XMATTERS_TIMEOUT_MS: "NaN" },
    { XMATTERS_MAX_RESPONSE_BYTES: "-2" },
    { XMATTERS_MAX_UPLOAD_BYTES: "Infinity" },
  ])(
    "rejects invalid configuration without echoing credentials: %j",
    (override) => {
      expect(() => loadConfig({ ...base, ...override })).toThrow();
    },
  );
  it("loads explicitly bounded operational options and write opt-in", () => {
    expect(
      loadConfig({
        ...base,
        XMATTERS_ALLOW_WRITES: "true",
        XMATTERS_TIMEOUT_MS: "1000",
        XMATTERS_MAX_RESPONSE_BYTES: "1024",
        XMATTERS_MAX_UPLOAD_BYTES: "2048",
      }),
    ).toMatchObject({
      allowWrites: true,
      timeoutMs: 1000,
      maxResponseBytes: 1024,
      maxUploadBytes: 2048,
    });
    expect(
      loadConfig({ ...base, XMATTERS_ALLOW_WRITES: "false" }).allowWrites,
    ).toBe(false);
  });
  it.each([
    [
      { XMATTERS_USERNAME: "user", XMATTERS_PASSWORD: "test-only" },
      { type: "basic", username: "user", password: "test-only" },
    ],
    [
      { XMATTERS_ACCESS_TOKEN: "test-token" },
      { type: "bearer", token: "test-token" },
    ],
    [
      {
        XMATTERS_CLIENT_ID: "client",
        XMATTERS_USERNAME: "user",
        XMATTERS_PASSWORD: "test-only",
      },
      {
        type: "oauth",
        clientId: "client",
        username: "user",
        password: "test-only",
      },
    ],
    [
      { XMATTERS_CLIENT_ID: "client", XMATTERS_REFRESH_TOKEN: "test-refresh" },
      { type: "oauth", clientId: "client", refreshToken: "test-refresh" },
    ],
  ])("loads exactly one authentication mode from %j", (env, auth) => {
    expect(
      loadConfig({ XMATTERS_BASE_URL: base.XMATTERS_BASE_URL, ...env }).auth,
    ).toEqual(auth);
  });
  it.each([
    {},
    { XMATTERS_USERNAME: "user" },
    { XMATTERS_CLIENT_ID: "client" },
    {
      XMATTERS_API_KEY: "x-api-key-example",
      XMATTERS_API_SECRET: "test-only",
      XMATTERS_ACCESS_TOKEN: "test-token",
    },
    {
      XMATTERS_API_KEY: "x-api-key-example",
      XMATTERS_API_SECRET: "test-only",
      XMATTERS_USERNAME: "user",
      XMATTERS_PASSWORD: "test-only",
    },
    { XMATTERS_ACCESS_TOKEN: "test-token", XMATTERS_CLIENT_ID: "client" },
    { XMATTERS_REFRESH_TOKEN: "test-refresh" },
  ])("rejects ambiguous or incomplete auth modes %j", (env) => {
    expect(() =>
      loadConfig({ XMATTERS_BASE_URL: base.XMATTERS_BASE_URL, ...env }),
    ).toThrow();
  });
  it("loads API-key credentials without modifying their identifier and defaults to read-only", () => {
    expect(
      loadConfig({
        XMATTERS_BASE_URL: "https://example.xmatters.com",
        XMATTERS_API_KEY: "x-api-key-example",
        XMATTERS_API_SECRET: "test-only",
      }),
    ).toEqual({
      baseUrl: "https://example.xmatters.com",
      auth: {
        type: "api-key",
        apiKey: "x-api-key-example",
        apiSecret: "test-only",
      },
      allowWrites: false,
      timeoutMs: 30000,
      maxResponseBytes: 8388608,
      maxUploadBytes: 8388608,
    });
  });
});
