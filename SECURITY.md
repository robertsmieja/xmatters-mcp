# Security policy

Report vulnerabilities privately using GitHub's **Report a vulnerability** feature when available, or contact the repository owner privately. Do not include credentials, tenant data, or customer information in public issues.

## Trust model

This is a local **Streamable HTTP** MCP server, fixed to `127.0.0.1`. It exposes only `/mcp`, requires a separate operator-provisioned bearer secret on every request, validates the exact Host, and rejects every request carrying an Origin header (including localhost, `null`, and empty origins). There is no browser/CORS support, stdio transport, shell, or filesystem tool.

The local shared-secret gate is **not an implementation of MCP OAuth authorization**: there is no authorization-server discovery, protected-resource metadata, user consent flow, audience-bound issued token, or per-user scope policy. It is intentionally limited to trusted non-browser clients on the same host. Do not expose it to a network, tunnel, or reverse proxy as a public/multi-user MCP service. A remote deployment needs separately reviewed TLS and standards-compliant OAuth resource-server authorization. See [conformance boundaries](docs/mcp-conformance.md).

The process owner controls its environment and MCP host. Anyone able to change the environment or process can change the security policy. Local applications possessing the MCP token share the same configured xMatters identity and in-memory OAuth state; this is not a multi-tenant authorization boundary. Protect and rotate the MCP token separately from xMatters credentials. HTTP is not inherently safer than stdio, which remains part of the MCP specification.

- Use a dedicated xMatters identity with least-privilege permissions. Endpoint coverage is not a grant of tenant permission.
- API credentials are supplied through the process environment, never tool arguments. Avoid pasting secrets into chats, public issues, or checked-in MCP configuration. `.env` files are ignored by version control and not loaded by application code. **Bun loads them by default**; the documented launch commands use `--no-env-file` to disable this.
- Only HTTPS xMatters tenant origins on port 443 are accepted. Redirects are not followed. Arbitrary URLs, path traversal, and model-controlled Authorization headers are not accepted.
- Writes are disabled unless `XMATTERS_ALLOW_WRITES=true`. Every non-GET operation also requires `confirm: true`. This includes token acquisition/refresh. Confirmation is a host/user workflow convention, not proof that a human approved; use your MCP host's per-tool approval controls.
- API responses and uploaded content are untrusted data, not instructions. xMatters responses may contain personal data, configuration secrets, scripts, or sensitive incident details: the MCP host receives data visible to the configured identity. Only grant access to appropriate users and models.
- No automatic retry or implicit pagination occurs. A timed-out write may have succeeded. Investigate the exact resource before resending.
- File uploads accept bounded base64 content, not local paths. Downloads return base64 content rather than writing files. Requests and responses have limits and deadlines.
- Configured credentials and OAuth tokens must not be returned in MCP results. Unexpected failures are reported without raw stack traces or response bodies. This intentionally limits error detail.

## Supported scope

The maintained version on `main` is the security-supported version. This community implementation has offline unit/transport tests, not a vendor certification or a production tenant acceptance test. Review permissions, limits, and the exact tool payload before enabling writes.
