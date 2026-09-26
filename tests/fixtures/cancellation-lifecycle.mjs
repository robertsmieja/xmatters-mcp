// Runs under the selected real runtime. All upstream activity is injected and synthetic.
import assert from "node:assert/strict";
import { request } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
const { start } = await import(pathToFileURL(process.argv[2]).href);
const token = "cancellation-probe-local-token-0123456789";
const env = {
  XMATTERS_BASE_URL: "https://example.xmatters.com",
  XMATTERS_API_KEY: "x-api-key-synthetic",
  XMATTERS_API_SECRET: "synthetic-only",
  XMATTERS_MCP_TOKEN: token,
  XMATTERS_MCP_PORT: "0",
};
const version = "2026-07-28";
const pending = [];
const cleanup = [];
const calls = [];
let active = 0;
let maximum = 0;
let closing;
const server = await start(
  env,
  async (_url, init) =>
    new Promise((resolve) => {
      active++;
      maximum = Math.max(maximum, active);
      let finished = false;
      pending.push({
        signal: init.signal,
        finish(response) {
          if (finished) return;
          finished = true;
          active--;
          resolve(response);
        },
      });
    }),
);
function send(method = "tools/call") {
  const req = request(server.url, {
    method: "POST",
    agent: false,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": version,
      "Mcp-Method": method,
      ...(method === "tools/call" ? { "Mcp-Name": "xmatters_get_people" } : {}),
    },
  });
  req.on("error", () => {});
  const closed = new Promise((resolve) => req.once("close", resolve));
  const status = new Promise((resolve) => {
    req.once("response", (res) => {
      res.resume();
      res.once("end", () => resolve(res.statusCode));
    });
    req.once("error", () => resolve(undefined));
  });
  req.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...(method === "tools/call"
          ? { name: "xmatters_get_people", arguments: {} }
          : {}),
        _meta: {
          "io.modelcontextprotocol/protocolVersion": version,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  );
  const current = { req, closed, status };
  calls.push(current);
  return current;
}
async function until(check) {
  const end = performance.now() + 2000;
  while (!check()) {
    assert.ok(performance.now() < end, "lifecycle condition timed out");
    await sleep(5);
  }
}
try {
  for (let i = 0; i < 8; i++) {
    const current = send();
    await until(() => pending.length === i + 1);
    current.req.destroy();
    await current.closed;
    await until(() => pending[i].signal.aborted);
  }
  assert.equal(
    await send("server/discover").status,
    429,
    "disconnected work must retain admission",
  );
  pending[0].finish(Response.json({ data: [] }));
  await sleep(30);
  assert.equal(
    await send("server/discover").status,
    200,
    "settlement must release admission",
  );
  send(); // Leave this request connected for listener shutdown.
  await until(() => pending.length === 9);
  let closed = false;
  closing = server.close().then(() => {
    closed = true;
  });
  await until(() => pending[8].signal.aborted);
  await sleep(30);
  assert.equal(closed, false, "close must await pending fetches");
  for (const entry of pending.slice(1))
    entry.finish(
      new Response(
        new ReadableStream({
          cancel() {
            return new Promise((resolve) => cleanup.push(resolve));
          },
        }),
      ),
    );
  await until(() => cleanup.length === 8);
  await sleep(30);
  assert.equal(closed, false, "close must await late response cleanup");
  for (const finish of cleanup) finish();
  await closing;
  assert.equal(active, 0);
  assert.equal(maximum, 8);
  console.log(
    JSON.stringify({
      runtime: process.versions.bun
        ? `bun ${process.versions.bun}`
        : `node ${process.versions.node}`,
      dispatched: pending.length,
      aborted: pending.filter((entry) => entry.signal.aborted).length,
      maximum,
      cleanup: cleanup.length,
      closed,
    }),
  );
} finally {
  for (const current of calls) current.req.destroy();
  for (const entry of pending)
    entry.finish(new Response(null, { status: 204 }));
  for (const finish of cleanup) finish();
  await closing;
  await server.close();
}
