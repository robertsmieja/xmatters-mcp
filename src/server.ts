import {
  Server,
  ProtocolError,
  ProtocolErrorCode,
  type Tool,
} from "@modelcontextprotocol/server";
import { buildTool, executeOperation } from "./tools.js";
import type { Operation, RequestExecutor } from "./tools.js";
import { trackWork } from "./request-work.js";
export interface ServerOptions {
  client: RequestExecutor;
  operations: readonly Operation[];
  allowWrites?: boolean;
}
const toolCatalogs = new WeakMap<
  readonly Operation[],
  { snapshot: string; tools: Tool[] }
>();

function listTools(operations: readonly Operation[]): Tool[] {
  // HTTP constructs a server per request. Reuse schemas, but invalidate them
  // if a library caller edits the catalog or any nested operation fields.
  const snapshot = JSON.stringify(operations);
  let catalog = toolCatalogs.get(operations);
  if (!catalog || catalog.snapshot !== snapshot) {
    catalog = { snapshot, tools: operations.map(buildTool) };
    toolCatalogs.set(operations, catalog);
  }
  // Keep SDK processing of one response from mutating another request's cache.
  return structuredClone(catalog.tools);
}

export function createServer(options: ServerOptions): Server {
  const operations = new Map(
    options.operations.map((operation) => [operation.id, operation]),
  );
  if (operations.size !== options.operations.length)
    throw new Error("Duplicate operation IDs");
  const server = new Server(
    { name: "xmatters-mcp", version: "0.2.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  server.setRequestHandler("tools/list", async () => ({
    tools: listTools(options.operations),
  }));
  server.setRequestHandler("tools/call", async ({ params }, ctx) => {
    const operation = operations.get(params.name);
    if (!operation)
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Unknown tool");
    return trackWork(
      executeOperation(
        operation,
        params.arguments,
        options.client,
        options.allowWrites ?? false,
        ctx.mcpReq.signal,
      ),
    );
  });
  const catalogUri = "xmatters://api/catalog";
  server.setRequestHandler("resources/list", async () => ({
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
  server.setRequestHandler("resources/read", async ({ params }) => {
    if (params.uri !== catalogUri)
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        "Unknown resource",
      );
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
