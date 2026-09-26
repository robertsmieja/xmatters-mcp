# Configuration reference

This reference describes environment configuration for the version 0.2.0 CLI. All settings are read at startup; restart the server after changing them. For installation and connection steps, see [Set up a local MCP connection](setup.md).

The application does not read `.env` files. Bun can load them before the application starts; use the documented `--no-env-file` launch commands to keep configuration in the operator-provided environment. Never put real credentials in chat, command-line arguments, or version control.

## Tenant and local access

| Variable                | Required / default | Meaning and constraints                                                                                                                                                                                            |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `XMATTERS_BASE_URL`     | Required           | HTTPS xMatters tenant origin on port 443, for example `https://example.xmatters.com`. No API path, query, fragment, or embedded credentials. Custom proxy domains are not supported.                               |
| `XMATTERS_MCP_TOKEN`    | Required           | Separate local access token: 32–256 characters from `A–Z`, `a–z`, `0–9`, `_`, and `-`. Generate at least 32 random bytes and encode as hex or unpadded base64url. Format validation does not establish randomness. |
| `XMATTERS_MCP_PORT`     | `3000`             | Integer from `0` to `65535`. `0` requests an available port; the startup message reports it. The bind address is always `127.0.0.1`.                                                                               |
| `XMATTERS_ALLOW_WRITES` | `false`            | Exactly `true` or `false`. Every non-GET tool call also requires `confirm: true`, including OAuth token acquisition and refresh.                                                                                   |

The MCP token controls access to the local listener. It is not an xMatters API credential and does not implement MCP OAuth authorization. All clients with this token share the configured xMatters identity.

## xMatters authentication

Choose exactly one mode. Variables for another mode must be absent, not empty: the loader detects a mode by the presence of its variables.

| Mode                        | Required variables                                             | Behavior                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| API-key Basic (recommended) | `XMATTERS_API_KEY`, `XMATTERS_API_SECRET`                      | The key is the complete HTTP Basic username, including `x-api-key-`. The server rejects a missing prefix; it does not add or change it.         |
| Native Basic                | `XMATTERS_USERNAME`, `XMATTERS_PASSWORD`                       | Uses the configured username and password for HTTP Basic authentication.                                                                        |
| Existing OAuth access token | `XMATTERS_ACCESS_TOKEN`                                        | Uses the supplied token. It is not refreshed automatically.                                                                                     |
| OAuth password grant        | `XMATTERS_CLIENT_ID`, `XMATTERS_USERNAME`, `XMATTERS_PASSWORD` | Credentials are available to the explicit token-acquisition tool; startup does not acquire a token.                                             |
| OAuth refresh grant         | `XMATTERS_CLIENT_ID`, `XMATTERS_REFRESH_TOKEN`                 | The explicit refresh tool exchanges the configured refresh token. A username/password pair may also be supplied for later explicit acquisition. |

OAuth tools accept no credentials from tool arguments. They keep acquired tokens in process memory and return non-secret status; tokens are not persisted. Acquisition and refresh require write opt-in and per-call confirmation. These outbound xMatters operations do not authorize incoming MCP clients.

A Flow Designer trigger must allow API-key authentication to accept API credentials. HTTP Basic transport alone does not mean a trigger configured for native Basic will accept an API key.

## Configurable limits

These CLI defaults are local safety limits, not xMatters maxima. Byte limits count bytes, not characters. Each value must be a positive integer no larger than its maximum.

| Variable                         | Default              | Maximum               | Applies to                                                                                  |
| -------------------------------- | -------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `XMATTERS_MCP_MAX_REQUEST_BYTES` | `16777216` (16 MiB)  | `104857600` (100 MiB) | Complete incoming MCP JSON envelope, including base64 uploads; checked before dispatch.     |
| `XMATTERS_TIMEOUT_MS`            | `30000` (30 seconds) | `2147483647` ms       | Outgoing xMatters request and response-body read together.                                  |
| `XMATTERS_MAX_RESPONSE_BYTES`    | `8388608` (8 MiB)    | `104857600` (100 MiB) | Response body received from xMatters.                                                       |
| `XMATTERS_MAX_UPLOAD_BYTES`      | `8388608` (8 MiB)    | `104857600` (100 MiB) | Outgoing JSON/form bodies and multipart uploads, including conservative multipart overhead. |

A file that xMatters accepts may still exceed these limits. Account for base64 expansion, multipart overhead, the MCP host's message limits, and available memory before raising a limit. Redirects and cross-origin requests remain blocked regardless of the size settings.

## Fixed listener limits

These limits are not configurable through environment variables:

- Request budget: burst of 60, refilling at one request per second, shared by all local clients.
- Concurrent work: at most eight in-flight requests. A slot remains occupied until both the HTTP exchange and its tracked upstream work settle.
- Rejected excess requests: HTTP 429 with `Retry-After: 1`.
- Incoming headers: 16 KiB maximum and a 10-second timeout.
- Complete incoming request: 30-second timeout, checked at one-second intervals.
- Idle keep-alive connection: five-second timeout.

A client disconnect cancels the outgoing fetch and response reader. Shutdown stops new connections, cancels active work, and waits for tracked cleanup, including work from disconnected clients. A library-injected fetch or executor that ignores cancellation and never settles can keep its slot and delay shutdown indefinitely.

Cancellation uses the error code `CANCELLED` without exposing the caller's reason. Deadline expiration uses `TIMEOUT`. Neither causes an automatic retry, and neither proves that an issued write had no effect. See [cancellation and shutdown](mcp-conformance.md#cancellation-and-shutdown) for the implementation rationale.
