import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("committed catalog passes the offline source-inventory audit", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/audit-api.mjs", "--offline"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const report = JSON.parse(result.stdout) as {
    ok: boolean;
    namedTools: number;
    definitionBlocks: number;
    errors: unknown[];
  };
  expect(report).toMatchObject({
    ok: true,
    namedTools: 179,
    definitionBlocks: 168,
    errors: [],
  });
});

test("catalog auditor tests independently meet 80% line, branch and function coverage", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--experimental-test-coverage",
      "--test-coverage-include=scripts/audit-api.mjs",
      "--test-coverage-lines=80",
      "--test-coverage-branches=80",
      "--test-coverage-functions=80",
      "tests/catalog-audit.test.mjs",
    ],
    { cwd: root, encoding: "utf8", timeout: 20_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(0);
});
