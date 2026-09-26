export { XMattersClient, XMattersError } from "./client.js";
export type { AuthConfig, ClientOptions, ApiRequest } from "./client.js";
export { createServer } from "./server.js";
export type { ServerOptions } from "./server.js";
export { loadConfig } from "./config.js";
export type { ServerConfig } from "./config.js";
export type { Operation, RequestExecutor } from "./tools.js";
import catalog from "./operations.json" with { type: "json" };
import type { Operation } from "./tools.js";
export const operations: readonly Operation[] = Object.freeze(
  catalog as Operation[],
);
