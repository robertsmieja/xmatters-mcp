import { describe, expect, it, vi } from "vitest";
import { normalizeErrorResponse } from "../../src/http-response.js";

function setup() {
  const sink = {
    writeHead: vi.fn(),
    write: vi.fn(() => false),
    end: vi.fn(),
    on: vi.fn(),
    destroyed: false,
  };
  return { sink, response: normalizeErrorResponse(sink) };
}
const error = {
  jsonrpc: "2.0",
  id: null,
  error: { code: -32700, message: "Invalid JSON — é" },
};

describe("SDK HTTP error compatibility", () => {
  it("normalizes split UTF-8 JSON errors and discards stale Content-Length", () => {
    const { sink, response } = setup();
    response.writeHead(400, {
      "Content-Type": "application/json",
      "Content-Length": "999",
      Connection: "close",
    });
    const bytes = Buffer.from(JSON.stringify(error));
    const cut = bytes.indexOf(Buffer.from("é")) + 1;
    expect(response.write(bytes.subarray(0, cut))).toBe(true);
    expect(sink.writeHead).not.toHaveBeenCalled();
    response.end(bytes.subarray(cut));
    expect(sink.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
      Connection: "close",
    });
    const body = JSON.parse(sink.end.mock.calls[0]![0]);
    expect(body).toEqual({ jsonrpc: "2.0", error: error.error });
  });
  it.each([0, "", "request-id", undefined])(
    "preserves valid or absent IDs (%s)",
    (id) => {
      const { sink, response } = setup();
      const body = JSON.stringify({ ...error, id });
      response.writeHead(404, {
        "content-type": "Application/JSON; charset=utf-8",
      });
      response.write(body);
      response.end();
      expect(JSON.parse(sink.end.mock.calls[0]![0])).toEqual(JSON.parse(body));
    },
  );
  it.each([{ error: "HTTP error", id: null }, null, []])(
    "leaves non-JSON-RPC JSON error bodies alone (%j)",
    (value) => {
      const { sink, response } = setup();
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
      expect(JSON.parse(sink.end.mock.calls[0]![0])).toEqual(value);
    },
  );
  it.each([
    [200, "application/json"],
    [200, "text/event-stream"],
    [500, "text/plain"],
    [202, undefined],
  ] as const)(
    "streams status %s / %s without buffering or changing backpressure",
    (status, type) => {
      const { sink, response } = setup();
      const headers = type ? { "content-type": type } : undefined;
      response.writeHead(status, headers);
      expect(sink.writeHead).toHaveBeenCalledWith(status, headers);
      expect(response.write("first")).toBe(false);
      response.end("last");
      expect(sink.write).toHaveBeenCalledWith("first");
      expect(sink.end).toHaveBeenCalledWith("last");
      const close = vi.fn();
      response.on("close", close);
      expect(sink.on).toHaveBeenCalledWith("close", close);
      sink.destroyed = true;
      expect(response.destroyed).toBe(true);
    },
  );
  it.each([
    ["invalid", "not JSON"],
    ["oversized", "x".repeat(65537)],
  ])("fails closed on %s internal JSON error output", (_, body) => {
    const { sink, response } = setup();
    response.writeHead(400, { "content-type": "application/json" });
    response.write(body);
    response.write("ignored");
    response.end();
    expect(sink.writeHead).toHaveBeenCalledWith(500, {
      "Content-Type": "application/json",
    });
    expect(JSON.parse(sink.end.mock.calls[0]![0])).toEqual({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal Server Error" },
    });
  });
});
