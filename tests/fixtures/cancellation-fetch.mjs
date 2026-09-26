// Test-only preload: every fetch is synthetic; no native fetch or ambient credentials.
import assert from "node:assert/strict";

let active = 0;
let maximum = 0;
function report(event) {
  console.error(`FIXTURE ${JSON.stringify({ event, active, maximum })}`);
}
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://example.xmatters.com");
  assert.equal(url.pathname, "/api/xm/1/people");
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "manual");
  assert.equal(
    new Headers(init.headers).get("Authorization"),
    `Basic ${Buffer.from("x-api-key-http-fixture:http-fixture-secret").toString("base64")}`,
  );
  const mode = url.searchParams.get("search");
  assert.ok(["pending", "stream"].includes(mode));
  const signal = init.signal;
  assert.equal(signal.aborted, false);
  active++;
  maximum = Math.max(maximum, active);
  report("started");
  if (mode === "pending")
    return new Promise((_resolve, reject) => {
      const abort = () => {
        report("aborted");
        active--;
        report("settled");
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  const abort = () => report("aborted");
  signal.addEventListener("abort", abort, { once: true });
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("{"));
      },
      cancel() {
        signal.removeEventListener("abort", abort);
        active--;
        report("settled");
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
};
