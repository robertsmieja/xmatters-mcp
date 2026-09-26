# Security policy

Report vulnerabilities privately through GitHub's **Report a vulnerability** feature when available, or contact the repository owner privately. Do not put credentials, tenant data, or customer information in public issues.

## Supported version

The maintained version on `main` receives security fixes. Tests use synthetic data; they are not vendor certification or production tenant acceptance tests. Review permissions, limits, and exact tool payloads before enabling writes.

## Local access boundary

The server listens on `127.0.0.1` and exposes only `/mcp` over Streamable HTTP. Every request needs a separate operator-provided bearer token. The listener checks the exact Host and port and rejects every request with an Origin header, including localhost, `null`, and empty values. It has no browser/CORS support, stdio transport, shell tool, or filesystem tool.

**The local token is not MCP OAuth authorization.** The server does not implement authorization-server discovery, protected-resource metadata, a user consent flow, audience-bound issued tokens, or per-user scopes. It supports trusted, non-browser clients on the same machine.

Do not expose the listener to a network, tunnel, or public reverse proxy. A remote or multi-user deployment needs a separate security review, TLS, and standards-compliant OAuth resource-server authorization. See the [protocol and authorization boundaries](docs/mcp-conformance.md).

The process owner controls the environment and MCP host and can change the security policy. Anyone with the MCP token shares the configured xMatters identity and in-memory OAuth state. This is not a multi-tenant boundary. Protect and rotate the MCP token separately from xMatters credentials.

HTTP is not inherently safer than stdio. Removing stdio is a project choice, not a claim that the MCP specification deprecated it.

## Credentials and outbound requests

Use a dedicated xMatters identity with the least privileges needed. Endpoint coverage does not grant permissions.

Supply API credentials through the server process's private environment, never tool arguments. Do not put them in chats, public issues, or checked-in host configuration. Git ignores `.env` files, and application code does not load them. Bun does load them by default; use the documented `--no-env-file` launch commands.

The HTTP client accepts only HTTPS xMatters tenant origins on port 443. It does not follow redirects or accept arbitrary URLs, path traversal, or model-controlled Authorization headers. Configured credentials and OAuth tokens must not appear in MCP results. Unexpected errors omit raw stack traces and response bodies, which limits the available diagnostic detail.

## Writes and uncertain outcomes

Writes are disabled unless the operator sets `XMATTERS_ALLOW_WRITES=true`. Every non-GET operation also requires `confirm: true`, including OAuth token acquisition and refresh. That argument is a workflow safeguard, not proof of human consent; use the host's per-tool approval controls.

The server does not retry requests or paginate automatically. A write may succeed before a timeout or cancellation reaches the client. Inspect the exact resource before resending. Cancelling a request does not roll back a remote change, and API acceptance does not prove alert delivery.

## Data handling and resource limits

Treat API responses and uploaded content as untrusted data, not instructions. xMatters responses may contain personal information, configuration secrets, scripts, or incident details. The MCP host receives the data visible to the configured identity, so restrict access to appropriate users and models.

Uploads accept bounded base64 content, not local paths. Downloads return base64 rather than writing files. Incoming requests, outgoing requests, and responses have [size and time limits](docs/configuration.md#configurable-limits); the listener also limits request rate and concurrent work.

Shutdown cancels active requests and waits for tracked cleanup. Library-injected code that ignores cancellation can keep shutdown waiting. See [cancellation and shutdown](docs/mcp-conformance.md#cancellation-and-shutdown) for details.
