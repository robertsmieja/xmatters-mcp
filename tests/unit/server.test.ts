import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import type { Operation } from "../../src/tools.js";

const operation: Operation = {
  id: "xmatters_get_people",
  title: "Get people",
  group: "PEOPLE",
  method: "GET",
  path: "/api/xm/1/people",
  docsUrl: "https://help.xmatters.com/xmapi/#get-people",
  request: "none",
  response: "json",
  pathParams: [],
  queryParams: ["offset", "limit"],
  bodyParams: [],
  requiredQueryParams: [],
  requiredBodyParams: [],
};
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
async function setup(
  operations: Operation[] = [operation],
  allowWrites?: boolean,
) {
  const request = vi.fn().mockResolvedValue({ data: [{ id: "one" }] });
  const server = createServer({ client: { request }, operations, allowWrites });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(
    () => client.close(),
    () => server.close(),
  );
  return { client, request };
}

describe("MCP server", () => {
  it("dispatches through tools/call and returns structured API data", async () => {
    const { client, request } = await setup();
    const response = await client.callTool({
      name: operation.id,
      arguments: { query: { limit: 1 } },
    });
    expect(response.structuredContent).toEqual({
      data: { data: [{ id: "one" }] },
    });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/xm/1/people",
      query: { limit: 1 },
      responseType: "json",
    });
  });
  it("returns a protocol error for unknown tool names without making a request", async () => {
    const { client, request } = await setup();
    await expect(
      client.callTool({ name: "not_a_tool", arguments: {} }),
    ).rejects.toThrow(/Unknown tool/);
    expect(request).not.toHaveBeenCalled();
  });
  it("returns tool-level validation errors and applies read-only mode by default", async () => {
    const mutation: Operation = {
      ...operation,
      id: "xmatters_create_person",
      method: "POST",
      request: "json",
    };
    const { client, request } = await setup([mutation]);
    const result = await client.callTool({
      name: mutation.id,
      arguments: { body: {}, confirm: true },
    });
    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
  it("makes explicitly enabled and confirmed mutations available", async () => {
    const mutation: Operation = {
      ...operation,
      id: "xmatters_create_person",
      method: "POST",
      request: "json",
    };
    const { client, request } = await setup([mutation], true);
    expect(
      (
        await client.callTool({
          name: mutation.id,
          arguments: { body: {}, confirm: true },
        })
      ).isError,
    ).not.toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });
  it("exposes the full operation manifest as a read-only MCP resource", async () => {
    const { client } = await setup();
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual([
      "xmatters://api/catalog",
    ]);
    const data = await client.readResource({ uri: "xmatters://api/catalog" });
    const item = data.contents[0];
    expect(
      item && "text" in item ? JSON.parse(item.text as string) : null,
    ).toMatchObject({ operationCount: 1, operations: [operation] });
    await expect(
      client.readResource({ uri: "file:///etc/passwd" }),
    ).rejects.toThrow(/Unknown resource/);
  });
  it("rejects duplicate tool IDs instead of silently overwriting a route", () => {
    expect(() =>
      createServer({
        client: { request: vi.fn() },
        operations: [operation, operation],
      }),
    ).toThrow(/Duplicate/);
  });
  it("completes an SDK handshake and exposes an endpoint tool", async () => {
    const { client } = await setup();
    expect(client.getServerVersion()?.name).toBe("xmatters-mcp");
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      operation.id,
    ]);
  });
});
