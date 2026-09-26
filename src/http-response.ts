import type { NodeServerResponseLike } from "@modelcontextprotocol/node";

// SDK 2.1.0 emits id:null in early errors, including in the Node adapter.
// The 2026-07-28 wire schema requires an omitted ID when it is unknown.
// Buffer only bounded JSON errors; successful/SSE responses retain streaming.
export function normalizeErrorResponse(
  sink: NodeServerResponseLike,
): NodeServerResponseLike {
  let status = 200;
  let headers: Record<string, string> = {};
  let buffering = false;
  let overflow = false;
  let size = 0;
  let chunks: Buffer[] = [];
  const append = (chunk: string | Uint8Array) => {
    if (overflow) return;
    size +=
      typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
    if (size > 65536) {
      overflow = true;
      chunks = [];
    } else chunks.push(Buffer.from(chunk));
  };
  return {
    get destroyed() {
      return sink.destroyed;
    },
    on(event, listener) {
      return sink.on(event, listener);
    },
    writeHead(code, fields) {
      status = code;
      headers = { ...fields };
      const type =
        Object.entries(headers).find(
          ([key]) => key.toLowerCase() === "content-type",
        )?.[1] ?? "";
      buffering = status >= 400 && /^application\/json(?:\s*;|$)/i.test(type);
      if (!buffering) return sink.writeHead(code, fields);
    },
    write(chunk) {
      if (!buffering) return sink.write(chunk);
      append(chunk);
      return true;
    },
    end(chunk) {
      if (!buffering) return sink.end(chunk);
      if (chunk !== undefined) append(chunk);
      let body: string;
      try {
        if (overflow)
          throw new Error("Internal error response exceeded its budget");
        const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (message?.jsonrpc === "2.0" && message.error && message.id === null)
          delete message.id;
        body = JSON.stringify(message);
        // Re-serialization may change the byte length, including after ID removal.
        headers = Object.fromEntries(
          Object.entries(headers).filter(
            ([key]) => key.toLowerCase() !== "content-length",
          ),
        );
      } catch {
        status = 500;
        headers = { "Content-Type": "application/json" };
        body = JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal Server Error" },
        });
      }
      chunks = [];
      sink.writeHead(status, headers);
      return sink.end(body);
    },
  };
}
