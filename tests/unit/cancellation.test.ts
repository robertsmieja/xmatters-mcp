import { request as httpRequest } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { start } from "../../src/cli.js";
import { startHttp } from "../../src/http.js";
import { loadHttpConfig } from "../../src/config.js";
import { createServer } from "../../src/server.js";
import { operations } from "../../src/index.js";
import type { ApiRequest } from "../../src/client.js";
import {
  fixtureKey,
  fixtureSecret,
  fixtureToken,
  rpcHeaders,
  rpcMessage,
  wireRequest,
} from "../helpers/http-process.js";

const env = {
  XMATTERS_BASE_URL: "https://example.xmatters.com",
  XMATTERS_API_KEY: fixtureKey,
  XMATTERS_API_SECRET: fixtureSecret,
  XMATTERS_MCP_TOKEN: fixtureToken,
  XMATTERS_MCP_PORT: "0",
};

function call(url: string) {
  const req = httpRequest(
    url,
    {
      method: "POST",
      agent: false,
      headers: {
        ...rpcHeaders("tools/call"),
        "Mcp-Name": "xmatters_get_people",
      },
    },
    (res) => res.resume(),
  );
  req.on("error", () => {});
  const closed = new Promise<void>((resolve) => req.once("close", resolve));
  req.end(
    JSON.stringify(
      rpcMessage("tools/call", { name: "xmatters_get_people", arguments: {} }),
    ),
  );
  return { req, closed };
}

describe("upstream request lifecycle", () => {
  it("retains admission after TIMEOUT responses until ignored fetches settle", async () => {
    const pending: { signal: AbortSignal; finish: () => void }[] = [];
    const server = await start(
      { ...env, XMATTERS_TIMEOUT_MS: "20" },
      async (_input, init) =>
        new Promise<Response>((resolve) => {
          pending.push({
            signal: init!.signal!,
            finish: () => resolve(Response.json({ data: [] })),
          });
        }),
    );
    try {
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          wireRequest(server.url, {
            headers: {
              ...rpcHeaders("tools/call"),
              "Mcp-Name": "xmatters_get_people",
            },
            body: JSON.stringify(
              rpcMessage("tools/call", {
                name: "xmatters_get_people",
                arguments: {},
              }),
            ),
          }),
        ),
      );
      expect(pending).toHaveLength(8);
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body).result.structuredContent.code).toBe(
          "TIMEOUT",
        );
      }
      expect(pending.every((entry) => entry.signal.aborted)).toBe(true);
      expect((await wireRequest(server.url)).status).toBe(429);
    } finally {
      for (const entry of pending) entry.finish();
      await server.close();
    }
  });
  it("awaits cancellation cleanup of a late fetch response", async () => {
    let signal: AbortSignal | undefined;
    let deliver!: (response: Response) => void;
    let finish!: () => void;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const server = await start(
      env,
      async (_input, init) =>
        new Promise<Response>((resolve) => {
          signal = init!.signal!;
          deliver = resolve;
        }),
    );
    const current = call(server.url);
    let closing: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(signal).toBeDefined());
      let closed = false;
      closing = server.close().then(() => {
        closed = true;
      });
      await vi.waitFor(() => expect(signal!.aborted).toBe(true));
      deliver(new Response(new ReadableStream({ cancel })));
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(closed).toBe(false);
      finish();
      await closing;
    } finally {
      current.req.destroy();
      deliver(new Response(null));
      finish?.();
      await closing;
      await server.close();
    }
  });
  it.each([false, true])(
    "awaits stalled response cancellation cleanup (reject: %s)",
    async (rejectCleanup) => {
      let signal: AbortSignal | undefined;
      let finish!: () => void;
      const cancel = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = () =>
              rejectCleanup
                ? reject(new Error("private cleanup failure"))
                : resolve();
          }),
      );
      const response = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("{"));
          },
          cancel,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
      const server = await start(env, async (_input, init) => {
        signal = init!.signal!;
        return response;
      });
      const current = call(server.url);
      let closing: Promise<void> | undefined;
      try {
        await vi.waitFor(() => expect(response.body!.locked).toBe(true));
        let closed = false;
        closing = server.close().then(() => {
          closed = true;
        });
        await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
        expect(signal!.aborted).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(response.body!.locked).toBe(false);
        expect(closed).toBe(false);
        finish();
        await closing;
      } finally {
        current.req.destroy();
        finish();
        await closing;
        await server.close();
      }
    },
  );
  it("awaits tool work even with a custom executor instead of XMattersClient", async () => {
    let signal: AbortSignal | undefined;
    let finish!: () => void;
    const request = (input: ApiRequest) =>
      new Promise<void>((resolve) => {
        signal = input.signal;
        finish = resolve;
      });
    const server = await startHttp(
      () => createServer({ client: { request }, operations }),
      loadHttpConfig(env),
    );
    const current = call(server.url);
    let closing: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(signal).toBeDefined());
      let closed = false;
      closing = server.close().then(() => {
        closed = true;
      });
      await vi.waitFor(() => expect(signal!.aborted).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(closed).toBe(false);
      finish();
      await closing;
    } finally {
      current.req.destroy();
      finish();
      await closing;
      await server.close();
    }
  });
  it.each([false, true])(
    "close awaits upstream settlement (already disconnected: %s)",
    async (disconnect) => {
      let signal: AbortSignal | undefined;
      let finish!: () => void;
      const server = await start(
        env,
        async (_input, init) =>
          new Promise<Response>((resolve) => {
            signal = init!.signal!;
            finish = () => resolve(Response.json({ data: [] }));
          }),
      );
      const current = call(server.url);
      let closing: Promise<void> | undefined;
      try {
        await vi.waitFor(() => expect(signal).toBeDefined());
        if (disconnect) {
          current.req.destroy();
          await current.closed;
          await vi.waitFor(() => expect(signal!.aborted).toBe(true));
        }
        let closed = false;
        closing = server.close().then(() => {
          closed = true;
        });
        await vi.waitFor(() => expect(signal!.aborted).toBe(true));
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(closed).toBe(false);
        await expect(wireRequest(server.url)).rejects.toThrow();
        finish();
        await closing;
        expect(closed).toBe(true);
      } finally {
        current.req.destroy();
        finish();
        await closing;
        await server.close();
      }
    },
  );
  it("retains admission until disconnected pending fetches actually settle", async () => {
    const pending: { signal: AbortSignal; finish: () => void }[] = [];
    const server = await start(
      env,
      async (_input, init) =>
        new Promise<Response>((resolve) => {
          pending.push({
            signal: init!.signal!,
            finish: () => resolve(Response.json({ data: [] })),
          });
        }),
    );
    const calls: ReturnType<typeof call>[] = [];
    try {
      for (let i = 0; i < 8; i++) {
        const current = call(server.url);
        calls.push(current);
        await vi.waitFor(() => expect(pending).toHaveLength(i + 1));
        current.req.destroy();
        await current.closed;
        await vi.waitFor(() => expect(pending[i]!.signal.aborted).toBe(true));
      }
      expect((await wireRequest(server.url)).status).toBe(429);
      expect(pending).toHaveLength(8);
      for (const entry of pending) entry.finish();
      await vi.waitFor(async () =>
        expect((await wireRequest(server.url)).status).toBe(200),
      );
    } finally {
      for (const current of calls) current.req.destroy();
      for (const entry of pending) entry.finish();
      await server.close();
    }
  });
});
