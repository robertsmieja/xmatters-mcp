# MCP protocol target and conformance boundaries

## Target

Version 0.2.0 targets **MCP 2026-07-28**, the current published revision at the time of this migration. This revision uses self-contained requests and per-request metadata rather than a required `initialize` handshake.[2]

The server uses the stable official TypeScript SDK packages `@modelcontextprotocol/server` and `@modelcontextprotocol/node`, pinned to **2.1.0**. It opts into the modern protocol through `createMcpHandler(factory, { legacy: "reject" })`; merely upgrading a hand-connected SDK `Server` would still leave legacy protocol behavior.[4]

The application exposes only Streamable HTTP at **POST `/mcp`**. It does not expose stdio, the old two-endpoint HTTP+SSE transport, sessions, resumable streams, or legacy initialization. stdio remains a standard transport in the upstream specification; its removal here is a deliberate project choice, not a claim that MCP deprecated it. The old HTTP+SSE transport is deprecated upstream.[1][5]

## Implemented protocol surface

- `server/discover`, with the supported revision and tool/resource capabilities.
- `tools/list` and `tools/call`, preserving the published xMatters operation catalog.
- `resources/list` and `resources/read` for `xmatters://api/catalog`.
- SDK-provided JSON-RPC request validation, error handling, and modern result envelopes.
- Independent requests; a client can call a tool without initializing or first discovering the server.
- JSON tool results with text plus matching `structuredContent`; input validation and execution failures remain tool-level `isError` results.
- Conservative SDK cache hints (`ttlMs: 0`, `cacheScope: "private"`) and server identity metadata, plus HTTP `Cache-Control: no-store` on JSON responses. SDK SSE responses instead use `no-cache, no-transform`. These hints follow the modern revision's caching vocabulary.[7]

No optional prompts, sampling, elicitation, custom header-mirrored tool arguments, subscriptions, or task extensions are advertised by the application. Future additions need their own conformance tests; absence of an optional capability is not a license to accept it silently.

## HTTP and version validation

Modern clients send a single JSON-RPC message per POST, JSON content, an Accept header covering JSON and SSE, `MCP-Protocol-Version`, `Mcp-Method`, and the applicable `Mcp-Name`. Required protocol version/capability metadata travels in `params._meta`; mirrored headers must match the body.[1]

The official SDK handles the modern protocol envelope, including:

- `400` for invalid or mismatched required headers/metadata.
- `400` and `UnsupportedProtocolVersion` (`-32022`) naming supported versions when a requested revision is unsupported.
- `404` and JSON-RPC `-32601` for unknown RPC methods.
- `202` with an empty body for accepted notification POSTs; acknowledgement does not mean an unsupported notification has caused an action.
- No generated or echoed MCP session identifier.

The application checks Host, Origin, and the local access token **before** forwarding a request to the SDK. It accepts only the exact `/mcp` request target, with no query string or encoded route aliases, and returns `405` with `Allow: POST` for other methods at that target. No standalone GET SSE stream or DELETE session endpoint is offered. Rejecting these legacy operations is the modern-only posture described by the specification.[1]

### SDK error-envelope compatibility

The authoritative 2026-07-28 schema declares an optional error ID of type string or number, not `null`.[8] SDK 2.1.0 nevertheless emits `id: null` for some early parse, batch, and oversized-body errors (including the Node adapter’s own errors). A bounded response adapter removes only those null IDs, preserving valid IDs such as numeric zero, status codes, and error payloads. It buffers only JSON error responses (at most 64 KiB); successful JSON and SSE responses retain streaming and backpressure. Malformed or oversized internal JSON error output fails closed with a generic 500 error.

The modern SDK does not reject `Accept: text/plain`. Advertising JSON plus SSE is a client requirement, not a server requirement to return 406; this application adds no stricter Accept policy.[1]

## Security and the authorization exception

The HTTP binding requires Origin validation and recommends loopback-only binding and authentication for local servers.[1] The tools specification additionally requires input validation, access controls, invocation rate limiting, and output sanitization.[6] This implementation:

- Binds only `127.0.0.1`; there is no configurable wildcard/network bind.
- Validates the exact loopback/localhost Host and bound port, not forwarding headers.
- Rejects **all** requests carrying an Origin header, including empty, `null`, and localhost values. Only non-browser clients are in scope; there is no CORS allowlist.
- Requires a separate operator-provisioned `XMATTERS_MCP_TOKEN` on every request, using a timing-safe comparison after checking length. Tokens in query parameters are not accepted.
- Bounds incoming request bytes before JSON parsing/dispatch and retains the existing outgoing xMatters byte/deadline restrictions.
- Applies one admission budget per listener/shared credential: burst 60, refill one request per second, at most eight in-flight requests; overflow returns `429` and `Retry-After: 1`. Untrusted client identity cannot reset the budget.
- Preserves read-only-by-default behavior and the operator opt-in plus per-call confirmation required for mutations.

### Cancellation and shutdown

The tool bridge forwards the SDK's `ctx.mcpReq.signal` through operation execution to the xMatters client's total deadline, fetch, and response reader. Pre-aborted calls do not issue fetches. Cancellation reasons are replaced with fixed safe errors (`CANCELLED`), while deadline failures retain `TIMEOUT`; neither triggers retries. An already-issued write may have taken effect: cancellation is not evidence of rollback.

SDK 2.1.0 closes the HTTP exchange without awaiting tool-handler settlement. Application request scopes therefore separately track tool execution, underlying fetch/response work, and response cancellation cleanup. Admission is released only after both exchange and tracked work settle. Listener `close()` (also used for CLI SIGINT/SIGTERM) closes connections, requests cancellation through the SDK, and awaits those scopes, including previously disconnected requests. A custom executor/fetch or stream cleanup that ignores cancellation and never settles keeps its slot and can keep `close()` pending indefinitely. There is no forced release that would allow outstanding work to bypass the limit, and no claim that local abort stops remote-side effects.

**This local shared-secret access gate is not the optional MCP OAuth authorization flow.** MCP makes authorization optional but recommends its OAuth-based specification for HTTP implementations that support authorization; that flow includes protected-resource metadata, authorization-server discovery, and token validation requirements.[3] This project deliberately uses pre-provisioned local credentials for same-host non-browser clients instead, and does not claim OAuth conformance, per-user scopes, issued-token audience binding, remote/public-server security, or multi-tenant isolation. Do not deploy this listener behind a public reverse proxy as though it were an OAuth resource server. Such a deployment needs separately reviewed TLS and standards-compliant authorization.

The configured xMatters identity is shared by local clients possessing the MCP token. xMatters OAuth operations are **outbound tenant authentication**, not an implementation of MCP's inbound OAuth authorization flow.

## Verification and limits of the claim

Run:

```sh
npm ci
npm run check
npm run test:bun
```

- Unit tests enforce the existing per-file coverage gates and exercise modern SDK requests and raw protocol rejection cases.
- Node integration tests launch the built CLI and the installed npm bin symlink, then use a real HTTP SDK client for discovery, catalog enumeration, synthetic API execution, resources, and read-only protection.
- Bun integration tests launch Bun itself (not a Node script disguised by `bun run`), including the TypeScript entrypoint and installed package, using the same HTTP acceptance path. Node remains the development harness.
- Upstream calls use a test-only preload or injected fetch. Tests require no tenant credentials and must never page real recipients.
- Both runtimes exercise nine sequential active-request disconnects, pending fetches and stalled response bodies, active SIGINT/SIGTERM shutdown, and admission/shutdown retention through delayed noncooperative fetch settlement and late response cleanup.

This is a tested implementation target, **not an MCP certification or proof that every optional feature and every RFC edge case has been exhaustively audited**. The authorization exception above is intentional and part of the supported deployment scope. A passing protocol suite is not a live xMatters tenant acceptance test. Review this document and rerun the wire-level tests when updating the SDK or protocol revision.

## Sources

[1] https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
[2] https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
[3] https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
[4] https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/docs/migration/support-2026-07-28.md
[5] https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
[6] https://modelcontextprotocol.io/specification/2026-07-28/server/tools
[7] https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching
[8] https://raw.githubusercontent.com/modelcontextprotocol/specification/main/schema/2026-07-28/schema.ts
