#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { XMattersClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import catalog from "./operations.json" with { type: "json" };
import type { Operation } from "./tools.js";

export async function start(
  env: NodeJS.ProcessEnv = process.env,
  transport: Transport = new StdioServerTransport(),
  fetch?: typeof globalThis.fetch,
): Promise<Server> {
  const config = loadConfig(env);
  const client = new XMattersClient({ ...config, fetch });
  const server = createServer({
    client,
    operations: catalog as Operation[],
    allowWrites: config.allowWrites,
  });
  await server.connect(transport);
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  start().catch(() => {
    console.error(
      "xmatters-mcp: startup failed; check XMATTERS_* configuration and transport. No credentials are logged.",
    );
    process.exitCode = 1;
  });
}
