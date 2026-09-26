# Contributing

## Prepare your environment

Use Node.js 22.12 or later and Bun 1.4.2. CI checks Node 22, 24 and 26, plus Bun 1.4.2. Node runs the Vitest/V8 coverage and packaging harness; separate integration checks launch Bun server processes.

Run the commands in this guide from the repository root. Install dependencies with npm:

```sh
npm ci
```

Tests must not require tenant credentials or trigger real alerts. Use injected HTTP transports or local fixtures, and label fixtures as synthetic test data. Never add real tenant responses, secrets, `.env` files, or personal data.

### Use Bun as the package manager

If you use Bun to install dependencies, follow the Bun CI path:

```sh
bun --no-env-file install --frozen-lockfile
bun --no-env-file run build
bun --no-env-file run test:bun
```

You still need Node for the test harness and the [full checks](#run-the-checks). Do not substitute `bun test` or `bun --bun run test:coverage`: these are Vitest tests with Node V8 coverage, not Bun-test suites.

## Make and test a change

1. Write a failing unit test for each behavior before implementing it. Run the test to confirm that it fails.
2. Implement the behavior and rerun the test.
3. Run the complete suite using [Run the checks](#run-the-checks).

Coverage gates apply to unit tests only: every runtime TypeScript source file must reach at least 80% statements, branches, functions, and lines. Protocol integration tests are a separate check. Do not exclude uncovered source files to satisfy a gate.

### Change protocol behavior

Retain wire-level checks for MCP 2026-07-28; a successful legacy initialization is not sufficient. Update [MCP conformance boundaries](docs/mcp-conformance.md), including authorization limitations. There is no stdio fallback.

### Add or change API tools

Cite the official xMatters REST reference and update the operation catalog and coverage inventory together. Follow the [catalog update procedure](docs/api-coverage.md#updating-the-catalog).

Preserve documented HTTP methods even when they are unconventional; many updates use POST. Keep JSON payloads extensible because nested workflow-specific schemas vary by tenant.

## Update dependencies

1. Update `package.json` and `package-lock.json` using npm.
2. Update `bun.lock` using Bun. For an initial import from the npm lockfile, use `bun --no-env-file install --lockfile-only`. For later changes, update both lockfiles and compare their resolved direct dependency versions.
3. Verify clean installations with both `npm ci` and `bun --no-env-file install --frozen-lockfile`.

Never hand-edit integrity values.

## Run the checks

After installing dependencies and before opening a pull request, run:

```sh
npm run check
npm run test:bun
npm run audit:api
npm audit --audit-level=high
npm pack --dry-run
```

`npm run check` checks formatting, types, unit coverage, the build, and Node integration tests. `npm run test:bun` checks Bun server processes. `npm run audit:api` checks the recorded catalog and inventory offline; it does not call xMatters.

Resolve check failures before opening the pull request. In the pull request description, explain the scope, verification, and any upstream documentation inconsistencies. Synthetic tests and source audits do not verify live tenant behavior.

## Contribution license

By contributing, you agree that your contributions are licensed under Apache-2.0.
