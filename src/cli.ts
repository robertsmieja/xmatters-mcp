#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { XMattersClient } from "./client.js";
import { loadConfig, loadHttpConfig } from "./config.js";
import { startHttp, type RunningHttpServer } from "./http.js";
import { createServer } from "./server.js";
import catalog from "./operations.json" with { type: "json" };
import type { Operation } from "./tools.js";

export async function start(
  env: NodeJS.ProcessEnv = process.env,
  fetch?: typeof globalThis.fetch,
): Promise<RunningHttpServer> {
  const config = loadConfig(env);
  const httpConfig = loadHttpConfig(env);
  const client = new XMattersClient({ ...config, fetch });
  return startHttp(
    () =>
      createServer({
        client,
        operations: catalog as Operation[],
        allowWrites: config.allowWrites,
      }),
    httpConfig,
  );
}

export async function runCli(
  env: NodeJS.ProcessEnv = process.env,
  args: string[] = process.argv.slice(2),
): Promise<RunningHttpServer> {
  if (args.length)
    throw new Error(
      "HTTP-only server; configure using XMATTERS_* environment variables, not transport flags",
    );
  const server = await start(env);
  const close = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await server.close();
  };
  const onSignal = () => {
    void close().catch(() => {
      console.error(
        "xmatters-mcp: shutdown failed. No credentials are logged.",
      );
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  console.error(`xmatters-mcp: listening on ${server.url}`);
  return { url: server.url, close };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  runCli().catch(() => {
    console.error(
      "xmatters-mcp: startup failed; check XMATTERS_* configuration and transport. No credentials are logged.",
    );
    process.exitCode = 1;
  });
}
