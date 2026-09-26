import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { buildTool, executeOperation } from "./tools.js";
import type { Operation, RequestExecutor } from "./tools.js";
export interface ServerOptions {
  client: RequestExecutor;
  operations: readonly Operation[];
  allowWrites?: boolean;
}
export function createServer(options: ServerOptions): Server {
  const operations = new Map(
    options.operations.map((operation) => [operation.id, operation]),
  );
  if (operations.size !== options.operations.length)
    throw new Error("Duplicate operation IDs");
  const server = new Server(
    { name: "xmatters-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  const tools = options.operations.map(buildTool);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const operation = operations.get(params.name);
    if (!operation) throw new McpError(ErrorCode.InvalidParams, "Unknown tool");
    return executeOperation(
      operation,
      params.arguments,
      options.client,
      options.allowWrites ?? false,
    );
  });
  const catalogUri = "xmatters://api/catalog";
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: catalogUri,
        name: "xMatters REST API operation catalog",
        mimeType: "application/json",
        description:
          "Published REST endpoints, input encodings and authoritative documentation links. No credentials.",
      },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    if (params.uri !== catalogUri)
      throw new McpError(ErrorCode.InvalidParams, "Unknown resource");
    return {
      contents: [
        {
          uri: catalogUri,
          mimeType: "application/json",
          text: JSON.stringify({
            source: "https://help.xmatters.com/xmapi/",
            scope: "Published REST API; not SOAP or private UI APIs",
            operationCount: options.operations.length,
            operations: options.operations,
          }),
        },
      ],
    };
  });
  return server;
}
