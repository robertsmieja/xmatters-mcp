# xMatters MCP Server

[![CI](https://github.com/robertsmieja/xmatters-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/robertsmieja/xmatters-mcp/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

An independent **TypeScript Model Context Protocol server** for the published xMatters REST API. **179 named MCP tools** cover all 168 DEFINITION blocks plus documented path variants and example-only routes in the current reference—not an arbitrary-URL request proxy. Runs locally over **Streamable HTTP** on **Node.js or Bun**, using the official MCP TypeScript SDK v2 and protocol revision **2026-07-28**.

- People, devices, groups, on-call schedules, events/alerts, incidents, workflows/plans, services, integrations, subscriptions, and the rest of the published REST reference.
- JSON, multipart uploads, binary attachment downloads, and OAuth token acquisition/refresh.
- Read-only by default. Mutations require an operator opt-in **and** `confirm: true` on each call.
- Auditable [endpoint coverage manifest](docs/api-coverage.md) and [source inventory](docs/api-inventory.json).
- CI enforces **at least 80% unit-test coverage** independently for statements, branches, functions, and lines. Every runtime TypeScript source is included, with all four thresholds enforced **per file**. Integration tests do not inflate the unit coverage metric.

**Scope:** the public reference at https://help.xmatters.com/xmapi/ as recorded in the inventory, not private UI APIs, undocumented endpoints, legacy SOAP, retired Dynamic Teams, or the deprecated 2012–2015 `/reapi` archive. API-method coverage is distinct from live tenant validation. Tests use synthetic fixtures and never page real recipients. Vendor documentation and tenant-specific permission/payload rules remain authoritative.

## Install from GitHub

Runtime: **Node.js 22.12+ or Bun 1.4.2+**. CI tests Node 22, 24, 26 and Bun 1.4.2. Node.js is still required for the development test/coverage harness and npm packaging; Bun is a supported server runtime and package manager.

```sh
git clone https://github.com/robertsmieja/xmatters-mcp.git
cd xmatters-mcp
npm ci
npm run build
```

Alternatively, install with Bun and either build or run the TypeScript entrypoint directly:

```sh
bun install --frozen-lockfile
bun run build
# After provisioning the environment described below:
bun --no-env-file run start:bun
# Or without a build:
bun --no-env-file run dev:bun
```

The documented Bun commands disable automatic `.env` loading. A bare `bun src/cli.ts` does not: Bun itself loads `.env` files by default. Do not use bare commands when relying on the operator-provided environment.

This repository is public; no npm-registry publication is implied. To inspect a distributable package, use `npm pack` after testing. The package includes compiled code, the operation catalog, API coverage documentation, and the license.

## Configure an MCP host

### Breaking change in 0.2.0

There is **no stdio transport or legacy HTTP+SSE endpoint**. Start the server independently (`npm start` or the Bun commands above), then connect the MCP host to its HTTP URL. Only modern **2026-07-28** clients are supported; an older `initialize`-only client must be upgraded. The CLI rejects transport flags instead of silently falling back.

The listener is fixed to **127.0.0.1** (not a public service). Before starting it, provision:

- `XMATTERS_BASE_URL` and one xMatters credential mode listed below.
- **`XMATTERS_MCP_TOKEN`**, a separate random local-access secret shared with your MCP host. Use at least 32 random bytes encoded as hex or base64url. The server accepts 32–256 characters from `A–Z`, `a–z`, `0–9`, `_`, `-`; length validation does not guarantee randomness. Never reuse xMatters credentials for this token.
- Optional `XMATTERS_MCP_PORT` (default **3000**; `0` selects an ephemeral port). The actual endpoint is printed to stderr after binding.

Configure your host's **Streamable HTTP** connection with the URL and an `Authorization: Bearer …` header. This is a schematic example; use the exact settings/secret interpolation supported by your client, and replace the placeholder privately:

```json
{
  "mcpServers": {
    "xmatters": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer REPLACE_PRIVATELY_WITH_MCP_TOKEN"
      }
    }
  }
}
```

Clients must support custom headers and the 2026-07-28 protocol. Browser-origin requests are intentionally rejected; no CORS is enabled. **The local shared-secret gate is not MCP OAuth authorization.** Do not expose or reverse-proxy this listener for remote/multi-user access without a separately reviewed TLS/OAuth resource-server deployment. See [protocol conformance and limitations](docs/mcp-conformance.md).

Removing stdio is a project policy, not an upstream deprecation claim: the current MCP spec still defines stdio; the deprecated transport is the older HTTP+SSE transport. HTTP introduces its own authentication and DNS-rebinding risks, addressed here through loopback binding, exact Host checks, rejection of all Origin headers, and authentication before dispatch.

Provision the following secrets privately through your host/secret manager. Do **not** put actual secrets in chat, command-line arguments, or version control. `.env.example` documents names; the server does not automatically load `.env` files.

Choose exactly one authentication mode:

- **API-key Basic (recommended):** `XMATTERS_API_KEY` is the complete `x-api-key-...` HTTP Basic username; `XMATTERS_API_SECRET` is its corresponding secret. The prefix is validated, not silently added or changed.
- **Native Basic:** `XMATTERS_USERNAME` and `XMATTERS_PASSWORD`.
- **Existing OAuth access token:** `XMATTERS_ACCESS_TOKEN`.
- **OAuth password grant:** `XMATTERS_CLIENT_ID`, `XMATTERS_USERNAME`, `XMATTERS_PASSWORD`.
- **OAuth refresh grant:** `XMATTERS_CLIENT_ID`, `XMATTERS_REFRESH_TOKEN`. Username/password may also be supplied for later explicit acquisition.

OAuth acquisition/refresh tools take **no model-provided credentials**. They retain tokens in process memory and return only non-secret status; tokens are not persisted. They are explicit operations and require write opt-in and confirmation. A supplied bearer token is not silently refreshed. Flow/integration API-key authentication must be enabled by the trigger itself; Basic transport does not imply a trigger configured for native Basic accepts API keys.

The base URL must be an HTTPS xMatters tenant **origin**, without path, query, fragment, or credentials, on port 443. Custom proxy domains and nonstandard deployments are not supported by this security policy.

## Tool inputs and outputs

Discover all named tools with MCP `tools/list`. Read `xmatters://api/catalog` for methods, paths, parameter names, encodings, and links to exact reference sections.

Inputs are grouped consistently:

- `path`: required raw path identifiers; values are encoded as individual segments. Use a UUID for names containing slashes, percent escapes, or dot segments.
- `query`: API query fields, including `offset`, `limit`, `embed`, filters, and dates. Values may be strings, numbers, booleans, or arrays of these. Arrays use the API's comma-separated convention.
- `body`: the complete JSON payload for JSON operations. Nested objects/arrays and workflow-specific properties are passed through. The server validates transport shape and required top-level fields, **not** every vendor enum, nested object, or tenant form schema.
- `upload`: `{ "name": "users.csv", "contentBase64": "...", "mimeType": "text/csv" }` for multipart operations. This accepts content, **not a local filename to read**. Optional `fieldName` defaults to `file`; scalar multipart fields go in `fields`.
- `confirm`: must be `true` for every non-GET operation.

Read-only example (choose the exact tool name from discovery):

```json
{ "query": { "limit": 25, "offset": 0 } }
```

Tool results contain JSON text and matching `structuredContent: { "data": ... }`. Binary downloads return base64 content and a MIME type inside `data`. Tool execution/validation failures set `isError: true`; unknown tool/resource names use MCP protocol errors.

### Pagination

One tool call makes one API request. Pagination metadata is preserved, not flattened or silently truncated. Continue by passing the documented `offset`/`limit` parameters for that endpoint. Do not assume the first page or the identity's visible subset represents the entire tenant. Returned `links.next` is data, never an arbitrary URL to execute.

### Enabling writes

Set `XMATTERS_ALLOW_WRITES=true` in the **operator-controlled** environment, then supply `confirm: true` for each write. Leave your host's approval controls enabled. The model cannot enable writes by changing tool arguments.

A confirm flag is a workflow safeguard, not cryptographic proof of human consent. Review exact targets, recipients, payloads, and paging impact before approving. No automatic retry is performed. After timeout, cancellation, or ambiguous failure, check the target before resending. Cancelling an already-issued write is **not rollback**: xMatters may have accepted it before the connection was aborted. A successful API response is not evidence of downstream alert delivery.

## Operational limits

- Local admission limits (shared across clients): a burst of **60 requests**, refilling **1 request/second**, with at most **8 in-flight**. Excess requests receive HTTP 429 and `Retry-After: 1`. These are local safety limits, not xMatters rate limits.
- Incoming HTTP headers have a 10-second/16-KiB limit; the complete incoming request has a 30-second timeout.
- `XMATTERS_MCP_MAX_REQUEST_BYTES`: 16,777,216 by default, covering the complete incoming MCP JSON envelope (including base64 uploads), capped at 100 MiB. Oversized bodies are rejected before dispatch.
- `XMATTERS_TIMEOUT_MS`: 30,000 by default, covering the outgoing xMatters HTTP request and response body.
- `XMATTERS_MAX_RESPONSE_BYTES`: 8,388,608 by default.
- `XMATTERS_MAX_UPLOAD_BYTES`: 8,388,608 by default.

Client disconnects cancel the outgoing fetch and any response reader. SIGINT/SIGTERM and the library listener's `close()` stop accepting connections, cancel active requests, and await tracked tool/fetch/response-cleanup settlement. An admission slot remains occupied until both the HTTP exchange and its upstream work settle, even after cancellation or timeout. Library-injected executors/fetches must cooperate with cancellation: a non-settling implementation retains its slot and can keep shutdown waiting indefinitely; it is not silently detached. Cancellation errors use a fixed `CANCELLED` classification without reflecting caller reasons; deadline expiration remains `TIMEOUT`.

These are local safety limits, not vendor maxima. Raise them deliberately when needed, considering base64 expansion, MCP host message limits, memory, and endpoint-specific restrictions (including bulk uploads). The HTTP client caps response/request buffers at 100 MiB and deadlines at 2,147,483,647 ms; a vendor-valid larger file can therefore exceed local limits. `XMATTERS_MAX_UPLOAD_BYTES` also bounds JSON/form bodies and conservative multipart overhead. Limits must be positive bounded integers. Redirects, credential-bearing URLs, and cross-origin requests are rejected.

## Development and verification

```sh
npm ci
npm run test:unit
npm run test:coverage
npm run build
npm run test:integration
npm run check
# Requires Bun; starts actual Bun servers, including the installed package:
npm run test:bun
npm audit --audit-level=high
npm pack --dry-run
```

The unit/coverage runner remains Node/Vitest; `test:bun` uses that harness to launch Bun server processes and install the tarball with Bun, rather than merely running Node scripts via `bun run`. Both `package-lock.json` and `bun.lock` are committed; see CONTRIBUTING for synchronized dependency updates.

Coverage reports are written to `coverage/`, including `coverage-summary.json`, LCOV, and HTML; CI uploads coverage artifacts for each Node version. See [CONTRIBUTING.md](CONTRIBUTING.md) for test-first development and API update expectations, and [SECURITY.md](SECURITY.md) for the threat model and disclosure policy.

No production credentials are needed for the test suite. Before production use, perform an authorized, narrow GET against your tenant and separately validate any approved write with exact-resource read-back. This project has not claimed those live checks on your behalf.

## License and affiliation

Copyright 2026 Robert Smieja. Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE). This is an independent community project, not an official xMatters product. xMatters documentation and trademarks retain their respective ownership.
