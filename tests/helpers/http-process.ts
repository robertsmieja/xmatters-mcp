import { spawn, spawnSync } from "node:child_process";
import { request, type IncomingHttpHeaders } from "node:http";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const fixture = fileURLToPath(
  new URL("../fixtures/http-fetch.mjs", import.meta.url),
);
export const runtime =
  process.env.XMATTERS_TEST_RUNTIME === "bun" ? "bun" : "node";
export const protocolVersion = "2026-07-28";
export const fixtureToken = "http-fixture-local-access-token-0123456789";
export const fixtureKey = "x-api-key-http-fixture";
export const fixtureSecret = "http-fixture-secret";
const requestTimeout = 4000;

export interface CliTarget {
  entrypoint: string;
  cwd?: string;
  installedBin?: boolean;
  preload?: string;
}

function invocation(target: CliTarget) {
  const preload = target.preload ?? fixture;
  if (runtime === "bun") {
    return {
      command: "bun",
      args: ["--no-env-file", "--preload", preload, target.entrypoint],
      env: {},
    };
  }
  // Invoke the installed symlink itself, not its resolved JS file: this catches
  // realpath/main-module and executable-bit packaging regressions.
  return target.installedBin
    ? {
        command: target.entrypoint,
        args: [],
        env: { NODE_OPTIONS: `--import=${JSON.stringify(preload)}` },
      }
    : {
        command: process.execPath,
        args: ["--import", preload, target.entrypoint],
        env: {},
      };
}

export function missingConfig(target: CliTarget) {
  const { command, args, env } = invocation(target);
  return spawnSync(command, args, {
    cwd: target.cwd ?? root,
    // Deliberately do not inherit tenant credentials, write opt-ins, proxy
    // settings, NODE_OPTIONS or other caller-controlled configuration.
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    timeout: 10000,
    killSignal: "SIGKILL",
  });
}

async function bounded<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}
export interface RunningCli {
  url: string;
  stdout(): string;
  stderr(): string;
  stop(signal?: "SIGINT" | "SIGTERM"): Promise<Exit>;
}

export async function startCli(target: CliTarget): Promise<RunningCli> {
  const { command, args, env } = invocation(target);
  const child = spawn(command, args, {
    cwd: target.cwd ?? root,
    env: {
      PATH: process.env.PATH ?? "",
      XMATTERS_BASE_URL: "https://example.xmatters.com",
      XMATTERS_API_KEY: fixtureKey,
      XMATTERS_API_SECRET: fixtureSecret,
      XMATTERS_MCP_TOKEN: fixtureToken,
      XMATTERS_MCP_PORT: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let spawnError: Error | undefined;
  let hasClosed = false;
  const closed = new Promise<Exit>((resolve) => {
    child.once("close", (code, signal) => {
      hasClosed = true;
      resolve({ code, signal });
    });
  });
  child.once("error", (error) => {
    spawnError = error;
  });
  let reportReady: (url: string) => void;
  const ready = new Promise<string>((resolve) => {
    reportReady = resolve;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = (stdout + chunk.toString()).slice(-65536);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-65536);
    const match =
      /^xmatters-mcp: listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)\r?$/m.exec(
        stderr,
      );
    if (match) reportReady(match[1]!);
  });

  let stopping: Promise<Exit> | undefined;
  function stop(signal: "SIGINT" | "SIGTERM" = "SIGTERM"): Promise<Exit> {
    return (stopping ??= (async () => {
      if (!hasClosed) child.kill(signal);
      try {
        return await bounded(closed, 5000, `CLI did not close after ${signal}`);
      } catch (error) {
        // Kill and reap even if startup, a request, or a test assertion fails.
        child.kill("SIGKILL");
        await bounded(closed, 5000, "CLI did not close after SIGKILL");
        throw error;
      }
    })());
  }

  try {
    const url = await bounded(
      Promise.race([
        ready,
        closed.then(({ code, signal }) => {
          throw (
            spawnError ??
            new Error(
              `CLI closed before listening (${code ?? signal}): ${stderr}`,
            )
          );
        }),
      ]),
      10000,
      "CLI did not report its loopback HTTP listener",
    );
    return { url, stdout: () => stdout, stderr: () => stderr, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export function makeClient(url: string) {
  const client = new Client(
    { name: "http-process-acceptance", version: "1.0.0" },
    {
      versionNegotiation: {
        mode: { pin: protocolVersion },
        probe: { timeoutMs: requestTimeout, maxRetries: 0 },
      },
    },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${fixtureToken}` } },
  });
  return { client, transport };
}

export const requestOptions = { timeout: requestTimeout };

export function rpcMessage(
  method = "server/discover",
  params: Record<string, unknown> = {},
  id = 1,
) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": protocolVersion,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": {
          name: "raw-http-test",
          version: "1",
        },
      },
    },
  };
}

export function rpcHeaders(method = "server/discover"): Record<string, string> {
  return {
    Authorization: `Bearer ${fixtureToken}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": protocolVersion,
    "Mcp-Method": method,
  };
}

export interface WireResponse {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

// Always use node:http for raw acceptance, including Host overrides. Node's
// fetch can silently discard Host, turning a rebinding test into a false pass.
export function wireRequest(
  url: string,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<WireResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: options.method ?? "POST",
      ...(options.path === undefined ? {} : { path: options.path }),
      headers: options.headers ?? rpcHeaders(),
      agent: false,
    });
    const timer = setTimeout(() => {
      req.destroy(new Error("HTTP acceptance request timed out"));
    }, requestTimeout);
    req.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.once("response", (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      res.once("end", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.end(options.body ?? JSON.stringify(rpcMessage()));
  });
}
