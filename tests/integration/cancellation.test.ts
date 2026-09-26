import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  fixtureKey,
  fixtureSecret,
  fixtureToken,
  root,
  rpcHeaders,
  rpcMessage,
  runtime,
  startCli,
  wireRequest,
  type RunningCli,
} from "../helpers/http-process.js";

const entrypoints = [
  join(root, "dist/cli.js"),
  ...(runtime === "bun" ? [join(root, "src/cli.ts")] : []),
];
const preload = join(root, "tests/fixtures/cancellation-fetch.mjs");
function events(server: RunningCli) {
  return server
    .stderr()
    .split("\n")
    .filter((line) => line.startsWith("FIXTURE "))
    .map(
      (line) =>
        JSON.parse(line.slice(8)) as {
          event: string;
          active: number;
          maximum: number;
        },
    );
}
function call(url: string, mode: string) {
  const req = request(
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
      rpcMessage("tools/call", {
        name: "xmatters_get_people",
        arguments: { query: { search: mode } },
      }),
    ),
  );
  return { req, closed };
}
function safeLogs(server: RunningCli) {
  expect(server.stdout()).toBe("");
  expect(
    server
      .stderr()
      .split("\n")
      .filter((line) => line && !line.startsWith("FIXTURE ")),
  ).toEqual([`xmatters-mcp: listening on ${server.url}`]);
  for (const secret of [fixtureKey, fixtureSecret, fixtureToken])
    expect(server.stderr()).not.toContain(secret);
}

describe.each(entrypoints)(
  `${runtime} active request cancellation: %s`,
  (entrypoint) => {
    it.each(["pending", "stream"])(
      "aborts nine sequential disconnected %s requests without accumulating work",
      async (mode) => {
        const server = await startCli({ entrypoint, preload });
        const calls: ReturnType<typeof call>[] = [];
        try {
          for (let i = 1; i <= 9; i++) {
            const current = call(server.url, mode);
            calls.push(current);
            await vi.waitFor(() =>
              expect(
                events(server).filter((event) => event.event === "started"),
              ).toHaveLength(i),
            );
            current.req.destroy();
            await current.closed;
            await vi.waitFor(() =>
              expect(
                events(server).filter((event) => event.event === "settled"),
              ).toHaveLength(i),
            );
          }
          const recorded = events(server);
          expect(
            recorded.filter((event) => event.event === "aborted"),
          ).toHaveLength(9);
          expect(recorded.at(-1)).toMatchObject({ active: 0, maximum: 1 });
          expect((await wireRequest(server.url)).status).toBe(200);
          expect(await server.stop()).toEqual({ code: 0, signal: null });
          safeLogs(server);
        } finally {
          for (const current of calls) current.req.destroy();
          await server.stop().catch(() => {});
        }
      },
    );

    it.each([
      ["pending", "SIGTERM"],
      ["stream", "SIGTERM"],
      ["pending", "SIGINT"],
      ["stream", "SIGINT"],
    ] as const)(
      "cancels an active %s request and exits cleanly on %s",
      async (mode, signal) => {
        const server = await startCli({ entrypoint, preload });
        const current = call(server.url, mode);
        try {
          await vi.waitFor(() =>
            expect(
              events(server).filter((event) => event.event === "started"),
            ).toHaveLength(1),
          );
          const began = performance.now();
          expect(await server.stop(signal)).toEqual({ code: 0, signal: null });
          expect(performance.now() - began).toBeLessThan(1000);
          expect(events(server).map((event) => event.event)).toEqual([
            "started",
            "aborted",
            "settled",
          ]);
          expect(events(server).at(-1)).toMatchObject({
            active: 0,
            maximum: 1,
          });
          safeLogs(server);
        } finally {
          current.req.destroy();
          await server.stop().catch(() => {});
        }
      },
    );

    it("retains admission and awaits shutdown through noncooperative fetch and late body cleanup", () => {
      const probe = join(root, "tests/fixtures/cancellation-lifecycle.mjs");
      const result = spawnSync(
        runtime === "bun" ? "bun" : process.execPath,
        [...(runtime === "bun" ? ["--no-env-file"] : []), probe, entrypoint],
        {
          cwd: root,
          env: { PATH: process.env.PATH ?? "" },
          encoding: "utf8",
          timeout: 10000,
          killSignal: "SIGKILL",
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        runtime: expect.stringContaining(runtime),
        dispatched: 9,
        aborted: 9,
        maximum: 8,
        cleanup: 8,
        closed: true,
      });
    });
  },
);
