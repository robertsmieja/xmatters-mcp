import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { operations } from "../../src/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = fileURLToPath(
  new URL("../fixtures/stdio-fetch.mjs", import.meta.url),
);
let directory: string;
let installedBin: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "xmatters-mcp-installed-bin-"));
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", directory], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
    }),
  ) as { filename: string }[];
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--prefer-offline",
      join(directory, packed[0]!.filename),
    ],
    { cwd: directory, encoding: "utf8", timeout: 60000 },
  );
  installedBin = join(directory, "node_modules", ".bin", "xmatters-mcp");
}, 120000);

afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("npm-installed bin symlink", () => {
  it("initializes, lists the packaged catalog and executes a synthetic GET through the installed executable", async () => {
    expect(lstatSync(installedBin).isSymbolicLink()).toBe(true);
    const transport = new StdioClientTransport({
      command: installedBin,
      env: {
        PATH: process.env.PATH ?? "",
        NODE_OPTIONS: `--import=${JSON.stringify(fixture)}`,
        XMATTERS_BASE_URL: "https://example.xmatters.com",
        XMATTERS_API_KEY: "x-api-key-stdio-fixture",
        XMATTERS_API_SECRET: "stdio-fixture-secret",
      },
      stderr: "pipe",
      cwd: directory,
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: "installed-bin-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({
        name: "xmatters-mcp",
        version: "0.1.0",
      });
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
        operations.map((op) => op.id),
      );
      const result = await client.callTool({
        name: "xmatters_get_people",
        arguments: { query: { limit: 1 } },
      });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual({
        data: { data: [{ id: "synthetic-person" }], count: 1, total: 1 },
      });
    } finally {
      await client.close();
    }
    expect(stderr).toBe("");
  });

  it("fails closed with missing configuration when invoked through the installed executable", () => {
    const child = spawnSync(installedBin, [], {
      cwd: directory,
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
      timeout: 10000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("startup failed");
  });
});
