# Contributing

Use Node.js 22.12 or later (22, 24 and 26 are checked in CI).

```sh
npm ci
npm run check
```

Write a failing unit test for each behavior before implementing it, then run it and the complete suite. Coverage gates apply to **unit tests only**, with a minimum of 80% statements, branches, functions, and lines across all runtime TypeScript sources; protocol integration tests are a separate check. Do not exclude uncovered source files to satisfy a gate.

When adding/changing API tools, cite the official xMatters REST reference and update the operation catalog and coverage inventory together. Preserve documented HTTP methods even when they are unconventional (many updates use POST). Keep JSON payloads extensible; nested workflow-specific schemas vary by tenant.

Tests must not require tenant credentials or trigger real alerts. Use injected HTTP transports or local fixtures, clearly labeled as synthetic test data. Never add real tenant responses, secrets, `.env` files, or personal data.

Before opening a pull request, run `npm run check`, `npm audit --audit-level=high`, and `npm pack --dry-run`. Explain scope, verification, and any upstream documentation inconsistencies.

By contributing, you agree that your contributions are licensed under Apache-2.0.
