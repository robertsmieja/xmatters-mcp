# xMatters MCP Server

[![CI](https://github.com/robertsmieja/xmatters-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/robertsmieja/xmatters-mcp/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Connect a local Model Context Protocol (MCP) host to the xMatters REST API. This independent TypeScript server runs on Node.js or Bun and exposes 179 named tools over authenticated Streamable HTTP.

The tools cover people, groups, on-call schedules, events, incidents, workflows, services, integrations, and the other operations in the [recorded public API reference](docs/api-coverage.md). They support JSON requests, multipart uploads, binary downloads, and explicit OAuth token acquisition and refresh. Tools use cataloged endpoints; they cannot request arbitrary URLs.

**Writes are disabled by default.** To enable them, the operator must set `XMATTERS_ALLOW_WRITES=true`. Each non-GET call also requires `confirm: true`. Keep your MCP host's approval controls enabled; a confirmation argument is not proof of human consent.

## Start here

Follow [Set up a local MCP connection](docs/setup.md) to install the server, supply credentials privately, and connect your host.

You need:

- Node.js 22.12+ or Bun 1.4.2+.
- A non-browser MCP host that supports Streamable HTTP, custom authorization headers, and MCP **2026-07-28**.
- An authorized xMatters tenant identity and a separate local MCP access token.

The server listens only on `127.0.0.1`. It is not a remote or multi-user service. Its local shared-secret authentication is **not MCP OAuth authorization**.

### Upgrading from 0.1.x

Version 0.2.0 removes the application's stdio transport. Start the server separately and configure your host with its HTTP URL. Legacy HTTP+SSE and clients that require an `initialize` handshake are not supported. See the [connection steps](docs/setup.md#connect-your-mcp-host) and [protocol compatibility notes](docs/mcp-conformance.md).

This is a project choice: stdio remains part of the MCP specification. HTTP is not inherently safer than stdio.

## Documentation

- [Set up a local MCP connection](docs/setup.md): install, start, connect, troubleshoot, and enable writes deliberately.
- [Configuration reference](docs/configuration.md): environment variables, authentication modes, defaults, and limits.
- [Tool reference](docs/tools.md): inputs, results, pagination, uploads, and write safeguards.
- [API coverage](docs/api-coverage.md): endpoint mappings, source evidence, and reproducible audits.
- [MCP protocol and conformance boundaries](docs/mcp-conformance.md): supported behavior, design choices, and SDK limitations.
- [Security policy](SECURITY.md): trust boundaries, deployment restrictions, and private vulnerability reporting.
- [Contributing](CONTRIBUTING.md): development setup, checks, and catalog maintenance.

## Coverage and verification

The recorded xMatters reference contains 168 `DEFINITION` blocks. The catalog expands them into 177 operation/path variants, plus two routes documented in request examples, for 179 tools. The [coverage report](docs/api-coverage.md) and [source inventory](docs/api-inventory.json) record the evidence and exclusions.

CI tests Node 22, 24, 26, and Bun 1.4.2. Unit tests must meet 80% coverage for statements, branches, functions, and lines in every runtime TypeScript file. Integration tests run separately and do not count toward those thresholds.

Tests use synthetic data and do not contact a tenant or page recipients. Passing tests and documented endpoint coverage do not establish tenant permissions, payload validity, or alert delivery. Check those separately with authorized requests before production use.

The project is available from GitHub; this does not imply an npm-registry release. See [package verification](CONTRIBUTING.md#run-the-checks) before distributing a tarball.

## License and affiliation

Copyright 2026 Robert Smieja. Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE). This is a community project, not an official xMatters product. xMatters retains ownership of its documentation and trademarks.
