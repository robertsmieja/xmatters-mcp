# Set up a local MCP connection

Use this guide to install the server and connect an MCP host on the same machine. Writes stay disabled until you explicitly enable them.

## Before you start

You need Git, Node.js 22.12+ or Bun 1.4.2+, and an MCP host that supports protocol revision 2026-07-28, Streamable HTTP, and custom authorization headers. A client that only supports the older `initialize` handshake will not work.

Obtain an authorized xMatters identity with only the permissions you need. Keep credentials in a private secret manager or process environment. Do not paste them into chats, command-line arguments, or files committed to Git.

This guide verifies the local MCP connection. Validating access to your tenant is a separate step that sends a real request.

## Install the server

1. Clone the repository and open its directory:

   ```sh
   git clone https://github.com/robertsmieja/xmatters-mcp.git
   cd xmatters-mcp
   ```

2. Install dependencies and build with one package manager.

   With npm:

   ```sh
   npm ci
   npm run build
   ```

   With Bun:

   ```sh
   bun --no-env-file install --frozen-lockfile
   bun --no-env-file run build
   ```

   A successful build creates `dist/cli.js`. Node.js is required for the development test/coverage harness and npm packaging, even if you use Bun to run the server.

## Supply the environment

1. Set `XMATTERS_BASE_URL` to your tenant's HTTPS origin, such as `https://example.xmatters.com`. Do not include an API path, query, fragment, or credentials. Only xMatters tenant domains on port 443 are accepted.

2. Choose one [xMatters authentication mode](configuration.md#xmatters-authentication). For API-key Basic authentication, set `XMATTERS_API_KEY` to the complete username, including `x-api-key-`, and set `XMATTERS_API_SECRET` to its secret. Remove variables for other modes rather than leaving them empty.

3. Generate a separate random local access token in your secret manager. Use at least 32 random bytes encoded as hex or unpadded base64url. Set `XMATTERS_MCP_TOKEN` to that value and make it available privately to your MCP host. Do not reuse an xMatters credential.

4. Leave `XMATTERS_ALLOW_WRITES` unset or set it to `false`. The default port is 3000. If that port is occupied, set `XMATTERS_MCP_PORT` to a free port, or use `0` to let the operating system choose one.

The application reads the environment of the server process. It does not load `.env` files. The repository's `.env.example` documents variable names; copying it to `.env` does not configure the application. Bun normally loads `.env` files itself, so the Bun commands in this guide use `--no-env-file`.

## Start the server

Run the server from the repository directory in the environment you just configured.

With Node.js:

```sh
npm start
```

With Bun:

```sh
bun --no-env-file run start:bun
```

Bun can also run the TypeScript entrypoint without building:

```sh
bun --no-env-file run dev:bun
```

With the default port, the server writes this line to stderr:

```text
xmatters-mcp: listening on http://127.0.0.1:3000/mcp
```

Keep the process running. If you chose port `0`, use the actual port in the startup message. To stop a foreground server, press Ctrl+C. SIGINT and SIGTERM stop new connections, cancel active requests, and wait for their cleanup.

## Connect your MCP host

1. Add a Streamable HTTP connection in your host using the URL from the startup message. Use the exact `/mcp` path, without a query string.

2. Configure the `Authorization` header with the value `Bearer ` followed by your `XMATTERS_MCP_TOKEN`. Use your host's private secret storage or supported interpolation mechanism.

   This JSON illustrates the connection fields; it is not a portable configuration format. Adapt it to your host and replace the placeholder privately:

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

3. Select protocol revision `2026-07-28` if your host requires an explicit choice. Request tool discovery (`tools/list`). The server should return 179 named tools. You can also read the `xmatters://api/catalog` resource for methods, paths, parameters, and source links. Neither operation contacts xMatters.

The local connection is ready when discovery succeeds. Do not test by opening the endpoint in a browser: the server rejects every request with an `Origin` header and does not support browser clients.

### Acquire an OAuth token, if required

If you chose an OAuth password or refresh grant, tenant tools return `AUTH_REQUIRED` until you explicitly acquire an access token. These token actions contact xMatters and use credentials from the server environment.

For read-only OAuth, use an access token obtained outside this server instead. Set `XMATTERS_ACCESS_TOKEN`, remove variables for other authentication modes, and restart the server to apply the change.

To acquire a token through the server:

1. Follow [Enable writes](#enable-writes).
2. Review and approve the tool for your configured grant in your MCP host, with `confirm: true`:
   - Password grant: `xmatters_obtain_an_access_token_and_refresh_token`.
   - Refresh grant: `xmatters_refresh_an_access_token`.
3. Check that the result's `data` contains `authenticated: true`. Tokens stay in server memory; they are not returned to the host.

### Validate tenant access (optional)

To validate tenant access, make a separately authorized, narrow GET through a discovered tool, such as `xmatters_get_people` with `{"query":{"limit":1}}`. This sends a real request and may return personal data. Check it in an approved environment, and do not treat one visible record or an empty result as a complete tenant inventory.

## Enable writes

Enable writes only after reviewing the identity's permissions and your host's approval controls. Writes can change tenant data or page recipients.

1. Stop the server, set `XMATTERS_ALLOW_WRITES=true` in its operator-controlled environment, and restart it.
2. Review the exact operation, targets, recipients, and payload in your host before approving the call. Include `confirm: true` in that call's arguments. OAuth token acquisition and refresh require the same write setting and per-call confirmation.
3. Read back the exact resource after a change. For alerting actions, check downstream delivery separately; an accepted API request does not prove delivery.

A model-provided confirmation flag is not proof of human consent. Keep host approvals enabled. After a timeout, cancellation, or ambiguous failure, inspect the target before resending. **Cancelling a write does not roll it back.**

To disable writes again, stop the server, unset `XMATTERS_ALLOW_WRITES` or set it to `false`, and restart. Restarting also discards acquired OAuth tokens because they exist only in process memory. You cannot retain a token from a grant action by restarting into read-only mode; use an externally supplied access token for that mode.

## Troubleshoot the connection

- If startup fails, check that required variables are present, exactly one authentication mode is configured, the MCP token meets its format rules, and the port is available. The CLI deliberately reports a generic error instead of logging credentials. It does not accept transport flags.
- For HTTP 401 from the local listener, check the MCP token and header format. This token is separate from your xMatters credentials.
- For HTTP 403 from the local listener, check that the host uses the bound loopback hostname and port and does not send an `Origin` header. Do not disable these checks or expose the listener through a proxy.
- For HTTP 400, check your host's protocol version and required MCP metadata against the [protocol notes](mcp-conformance.md#http-and-version-validation).
- For HTTP 429 from the local listener, send requests less frequently, reduce concurrent requests, and wait at least as long as `Retry-After` specifies before trying again. The [local limits](configuration.md#fixed-listener-limits) are separate from xMatters rate limits.

Do not expose this listener through a network address, tunnel, or public reverse proxy. It uses a local shared secret, not MCP OAuth authorization. Read the [security policy](../SECURITY.md) before changing deployment assumptions.
