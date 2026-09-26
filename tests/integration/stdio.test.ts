import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { operations } from "../../src/index.js";
const root = fileURLToPath(new URL("../../", import.meta.url));

describe("built stdio executable", () => {
  it("supports initialize, all tools, mocked API execution, read-only protection and resources over real process pipes", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        fileURLToPath(new URL("../fixtures/stdio-fetch.mjs", import.meta.url)),
        fileURLToPath(new URL("../../dist/cli.js", import.meta.url)),
      ],
      env: {
        PATH: process.env.PATH ?? "",
        XMATTERS_BASE_URL: "https://example.xmatters.com",
        XMATTERS_API_KEY: "x-api-key-stdio-fixture",
        XMATTERS_API_SECRET: "stdio-fixture-secret",
      },
      stderr: "pipe",
      cwd: root,
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: "stdio-acceptance", version: "1.0.0" });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({
        name: "xmatters-mcp",
        version: "0.1.0",
      });
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(
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
      const blocked = await client.callTool({
        name: "xmatters_create_a_person",
        arguments: { body: { targetName: "never-created" }, confirm: true },
      });
      expect(blocked.isError).toBe(true);
      const invalid = await client.callTool({
        name: "xmatters_get_people",
        arguments: { url: "https://attacker.invalid" },
      });
      expect(invalid.isError).toBe(true);
      const resource = await client.readResource({
        uri: "xmatters://api/catalog",
      });
      const text = resource.contents[0];
      expect(
        text && "text" in text
          ? JSON.parse(text.text as string).operationCount
          : 0,
      ).toBe(operations.length);
    } finally {
      await client.close();
    }
    expect(stderr).toBe("");
  });
  it("fails closed with missing configuration and no stdout or secret leakage", () => {
    const child = spawnSync(process.execPath, ["dist/cli.js"], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
      timeout: 10000,
    });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("startup failed");
  });
});
