import { z } from "zod";
import type { Tool, CallToolResult } from "@modelcontextprotocol/server";
import { XMattersError, type ApiRequest } from "./client.js";

export interface Operation {
  id: string;
  title: string;
  group: string;
  method: ApiRequest["method"];
  path: string;
  docsUrl: string;
  request: "none" | "json" | "multipart" | "form";
  response: "json" | "binary";
  pathParams: string[];
  queryParams: string[];
  bodyParams: string[];
  requiredQueryParams: string[];
  requiredBodyParams: string[];
  notes?: string;
  authAction?: "password" | "refresh";
}
export interface RequestExecutor {
  request(request: ApiRequest): Promise<unknown>;
}
export function buildTool(operation: Operation): Tool {
  const schema = z.toJSONSchema(argumentSchema(operation));
  const inputSchema = {
    ...schema,
    type: "object",
    required: schema.required ?? [],
  } as Tool["inputSchema"];
  const readOnly = operation.method === "GET";
  return {
    name: operation.id,
    title: operation.title,
    description: `${operation.title}. ${operation.method} ${operation.path}. ${operation.notes ?? ""} Body fields: ${operation.bodyParams.join(", ") || "none"}. Reference: ${operation.docsUrl}${readOnly ? "" : " Requires operator write opt-in and confirm:true; may notify recipients or change tenant data."}`,
    inputSchema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: readOnly,
      openWorldHint: true,
    },
  };
}
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
const queryValue = z.union([scalar, z.array(scalar)]);
const uploadSchema = z
  .object({
    name: z.string().min(1),
    contentBase64: z.string(),
    mimeType: z.string().optional(),
    fieldName: z.string().optional(),
  })
  .strict();

function argumentSchema(operation: Operation) {
  const shape: Record<string, z.ZodType> = {};
  if (operation.pathParams.length) {
    shape.path = z
      .object(
        Object.fromEntries(
          operation.pathParams.map((key) => [key, z.string().min(1)]),
        ),
      )
      .strict();
  }
  if (!operation.authAction) {
    const query = z
      .object(
        Object.fromEntries(
          operation.requiredQueryParams.map((key) => [key, queryValue]),
        ),
      )
      .catchall(queryValue)
      .describe(
        `API query parameters; arrays are comma-joined. Documented names: ${operation.queryParams.join(", ") || "none"}. Pagination is explicit using offset and limit; results are not automatically combined.`,
      );
    shape.query = operation.requiredQueryParams.length
      ? query
      : query.optional();
  }
  if (operation.request === "json") {
    const body = operation.requiredBodyParams.length
      ? z
          .object(
            Object.fromEntries(
              operation.requiredBodyParams.map((key) => [key, z.json()]),
            ),
          )
          .catchall(z.json())
      : z.json();
    shape.body = body.describe(
      `Complete API JSON payload (including nested fields). See ${operation.docsUrl}`,
    );
  }
  if (operation.request === "multipart") {
    shape.upload = uploadSchema;
    shape.fields = z.record(z.string(), z.string()).optional();
  }
  if (operation.method !== "GET")
    shape.confirm = z
      .literal(true)
      .describe(
        "Explicit approval of this exact mutation. Operator must also enable XMATTERS_ALLOW_WRITES.",
      );
  return z.object(shape).strict();
}

type ToolArguments = {
  path?: Record<string, string>;
  query?: ApiRequest["query"];
  body?: unknown;
  upload?: ApiRequest["upload"];
  fields?: Record<string, string>;
  confirm?: true;
};

function result(
  data: Record<string, unknown>,
  isError = false,
): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError,
  };
}

export async function executeOperation(
  operation: Operation,
  args: unknown,
  client: RequestExecutor,
  allowWrites = false,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  try {
    if (operation.method !== "GET" && !allowWrites) {
      return result(
        {
          error:
            "Writes are disabled. The operator must set XMATTERS_ALLOW_WRITES=true; every write also requires confirm:true.",
        },
        true,
      );
    }
    const parsed = argumentSchema(operation).safeParse(args ?? {});
    if (!parsed.success)
      return result(
        { error: "Invalid arguments; see the tool inputSchema." },
        true,
      );
    const {
      path: params = {},
      query,
      body,
      upload,
      fields,
    } = parsed.data as ToolArguments;
    let path = operation.path;
    for (const key of operation.pathParams) {
      const value = params[key]!;
      if (
        /[/\\%\u0000-\u001f\u007f]/.test(value) ||
        value === "." ||
        value === ".."
      ) {
        return result(
          {
            error:
              "Path parameters must be raw identifiers, without slashes, escapes, or dot segments.",
          },
          true,
        );
      }
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }
    const request: ApiRequest = {
      method: operation.method,
      path,
      responseType: operation.response,
    };
    if (signal !== undefined) request.signal = signal;
    if (query !== undefined) request.query = query;
    if (body !== undefined) request.body = body;
    if (upload !== undefined) request.upload = upload;
    if (fields !== undefined) request.fields = fields;
    if (operation.authAction) request.authAction = operation.authAction;
    const data = await client.request(request);
    return result({ data });
  } catch (error) {
    if (error instanceof XMattersError) {
      return result(
        {
          error: error.message,
          code: error.code,
          status: error.status,
          retryAfter: error.retryAfter,
        },
        true,
      );
    }
    return result(
      {
        error:
          "Request failed. Check configuration, permissions, network, and API constraints; no automatic retry was attempted.",
      },
      true,
    );
  }
}
