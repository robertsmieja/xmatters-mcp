import { timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createMcpHandler,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { HttpConfig } from "./config.js";
import { normalizeErrorResponse } from "./http-response.js";
import { withRequestWork } from "./request-work.js";

export interface RunningHttpServer {
  url: string;
  close(): Promise<void>;
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Connection: "close",
  });
  res.end(JSON.stringify({ error: message }));
}

export async function startHttp(
  factory: McpServerFactory,
  config: HttpConfig,
): Promise<RunningHttpServer> {
  const handler = createMcpHandler(factory, {
    legacy: "reject",
    responseMode: "auto",
    maxRequestBodySize: config.maxRequestBytes,
  });
  const nodeHandler = toNodeHandler(handler, {
    maxRequestBodySize: config.maxRequestBytes,
  });
  const expected = Buffer.from(config.token);
  const allowedHosts = new Set<string>();
  // One local PSK, one admission budget; client-declared identity is untrusted.
  let tokens = 60;
  let updated = performance.now();
  const active = new Set<Promise<void>>();
  const listener = createServer(
    {
      headersTimeout: 10_000,
      requestTimeout: 30_000,
      connectionsCheckingInterval: 1_000,
      keepAliveTimeout: 5_000,
      maxHeaderSize: 16 * 1024,
    },
    (req, res) => {
      // Every Origin is invalid for this non-browser endpoint, including duplicates.
      if (req.headers.origin !== undefined) {
        reject(res, 403, "Forbidden");
        return;
      }
      // Node can silently discard duplicate Host/Authorization fields in headers.
      const securityHeaders = new Set<string>();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]!.toLowerCase();
        if (!["host", "authorization"].includes(name)) continue;
        if (securityHeaders.has(name)) {
          reject(res, 400, "Bad Request");
          return;
        }
        securityHeaders.add(name);
      }
      if (!allowedHosts.has(req.headers.host ?? "")) {
        reject(res, 403, "Forbidden");
        return;
      }
      const authorization = req.headers.authorization;
      const supplied = Buffer.from(
        /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization ?? "")?.[1] ?? "",
      );
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="xmatters-mcp-local"');
        reject(res, 401, "Unauthorized");
        return;
      }
      if (req.url !== "/mcp") {
        reject(res, 404, "Not Found");
        return;
      }
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        reject(res, 405, "Method Not Allowed");
        return;
      }
      const now = performance.now();
      tokens = Math.min(60, tokens + (now - updated) / 1_000);
      updated = now;
      if (tokens < 1 || active.size >= 8) {
        res.setHeader("Retry-After", "1");
        reject(res, 429, "Too Many Requests");
        return;
      }
      tokens--;
      res.setHeader("Cache-Control", "no-store");
      const work = withRequestWork(() =>
        nodeHandler(req, normalizeErrorResponse(res)),
      ).catch(() => {
        if (res.headersSent) res.destroy();
        else reject(res, 500, "Internal Server Error");
      });
      active.add(work);
      const release = () => {
        active.delete(work);
      };
      void work.then(release, release);
    },
  );
  try {
    await new Promise<void>((resolve, rejectListen) => {
      const onError = (error: unknown) => {
        listener.off("error", onError);
        listener.off("listening", onListening);
        rejectListen(error);
      };
      const onListening = () => {
        listener.off("error", onError);
        resolve();
      };
      listener.once("error", onError);
      listener.once("listening", onListening);
      try {
        listener.listen(config.port, "127.0.0.1");
      } catch (error) {
        onError(error);
      }
    });
  } catch (error) {
    await handler.close();
    throw error;
  }
  const port = (listener.address() as AddressInfo).port;
  for (const hostname of ["127.0.0.1", "localhost"]) {
    allowedHosts.add(new URL(`http://${hostname}:${port}`).host);
  }
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close() {
      return (closing ??= (async () => {
        const stopped = new Promise<void>((resolve) => {
          listener.close(() => resolve());
        });
        listener.closeAllConnections();
        await handler.close();
        await Promise.allSettled(active);
        await stopped;
      })());
    },
  };
}
