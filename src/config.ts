import type { AuthConfig } from "./client.js";

export interface ServerConfig {
  baseUrl: string;
  auth: AuthConfig;
  allowWrites: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  maxUploadBytes: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value?.trim()) throw new Error(`${key} is required`);
  return value;
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const value = env[key];
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`${key} must be a positive safe integer`);
  }
  return result;
}

function loadAuth(env: NodeJS.ProcessEnv): AuthConfig {
  const has = (...keys: string[]) => keys.some((key) => env[key] !== undefined);
  const apiKeyMode = has("XMATTERS_API_KEY", "XMATTERS_API_SECRET");
  const bearerMode = has("XMATTERS_ACCESS_TOKEN");
  const oauthMode = has("XMATTERS_CLIENT_ID", "XMATTERS_REFRESH_TOKEN");
  const basicMode = !oauthMode && has("XMATTERS_USERNAME", "XMATTERS_PASSWORD");
  if (
    [apiKeyMode, bearerMode, oauthMode, basicMode].filter(Boolean).length !== 1
  ) {
    throw new Error(
      "Configure exactly one authentication mode: API key, Basic, bearer, or OAuth",
    );
  }
  if (apiKeyMode) {
    const apiKey = required(env, "XMATTERS_API_KEY");
    if (!apiKey.startsWith("x-api-key-") || apiKey === "x-api-key-") {
      throw new Error("XMATTERS_API_KEY must include the x-api-key- prefix");
    }
    return {
      type: "api-key",
      apiKey,
      apiSecret: required(env, "XMATTERS_API_SECRET"),
    };
  }
  if (bearerMode)
    return { type: "bearer", token: required(env, "XMATTERS_ACCESS_TOKEN") };
  if (oauthMode) {
    const auth: Extract<AuthConfig, { type: "oauth" }> = {
      type: "oauth",
      clientId: required(env, "XMATTERS_CLIENT_ID"),
    };
    if (has("XMATTERS_USERNAME", "XMATTERS_PASSWORD")) {
      auth.username = required(env, "XMATTERS_USERNAME");
      auth.password = required(env, "XMATTERS_PASSWORD");
    }
    if (has("XMATTERS_REFRESH_TOKEN"))
      auth.refreshToken = required(env, "XMATTERS_REFRESH_TOKEN");
    if (!auth.username && !auth.refreshToken)
      throw new Error("OAuth requires username/password or a refresh token");
    return auth;
  }
  return {
    type: "basic",
    username: required(env, "XMATTERS_USERNAME"),
    password: required(env, "XMATTERS_PASSWORD"),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const baseUrl = required(env, "XMATTERS_BASE_URL");
  const auth = loadAuth(env);
  const writes = env.XMATTERS_ALLOW_WRITES;
  if (writes !== undefined && writes !== "true" && writes !== "false") {
    throw new Error("XMATTERS_ALLOW_WRITES must be true or false");
  }
  return {
    baseUrl,
    auth,
    allowWrites: writes === "true",
    timeoutMs: positiveInteger(env, "XMATTERS_TIMEOUT_MS", 30000),
    maxResponseBytes: positiveInteger(
      env,
      "XMATTERS_MAX_RESPONSE_BYTES",
      8388608,
    ),
    maxUploadBytes: positiveInteger(env, "XMATTERS_MAX_UPLOAD_BYTES", 8388608),
  };
}
