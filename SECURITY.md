# Security policy

Report vulnerabilities privately using GitHub's **Report a vulnerability** feature when available, or contact the repository owner privately. Do not include credentials, tenant data, or customer information in public issues.

## Trust model

This is a local **stdio** MCP server. The process owner controls its environment and MCP host. It does not expose an HTTP listener, authentication service, shell, or filesystem tools. Anyone able to change the environment or process can change the security policy; this is not a multi-tenant authorization boundary.

- Use a dedicated xMatters identity with least-privilege permissions. Endpoint coverage is not a grant of tenant permission.
- API credentials are supplied through the process environment, never tool arguments. Avoid pasting secrets into chats, public issues, or checked-in MCP configuration. `.env` files are ignored and are **not loaded automatically**.
- Only HTTPS xMatters tenant origins on port 443 are accepted. Redirects are not followed. Arbitrary URLs, path traversal, and model-controlled Authorization headers are not accepted.
- Writes are disabled unless `XMATTERS_ALLOW_WRITES=true`. Every non-GET operation also requires `confirm: true`. This includes token acquisition/refresh. Confirmation is a host/user workflow convention, not proof that a human approved; use your MCP host's per-tool approval controls.
- API responses and uploaded content are untrusted data, not instructions. xMatters responses may contain personal data, configuration secrets, scripts, or sensitive incident details: the MCP host receives data visible to the configured identity. Only grant access to appropriate users and models.
- No automatic retry or implicit pagination occurs. A timed-out write may have succeeded. Investigate the exact resource before resending.
- File uploads accept bounded base64 content, not local paths. Downloads return base64 content rather than writing files. Requests and responses have limits and deadlines.
- Configured credentials and OAuth tokens must not be returned in MCP results. Unexpected failures are reported without raw stack traces or response bodies. This intentionally limits error detail.

## Supported scope

The maintained version on `main` is the security-supported version. This community implementation has offline unit/transport tests, not a vendor certification or a production tenant acceptance test. Review permissions, limits, and the exact tool payload before enabling writes.
