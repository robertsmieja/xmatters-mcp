import { describe, expect, it, vi } from "vitest";
import { XMattersClient } from "../../src/client.js";
import { operations } from "../../src/index.js";
import { buildTool, executeOperation } from "../../src/tools.js";

// Synthetic transport fixtures verify every descriptor's executable routing/encoding.
// They are NOT tenant acceptance tests or vendor payload validation.
describe("every cataloged operation is executable", () => {
  it.each(operations)(
    "$id: routes through the real client with its documented method and encoding",
    async (op) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () => {
          if (op.authAction)
            return Response.json({
              access_token: "issued-test-token",
              refresh_token: "issued-refresh-test-token",
              expires_in: 3600,
            });
          if (op.response === "binary")
            return new Response("attachment fixture", {
              headers: { "Content-Type": "text/plain" },
            });
          return Response.json({ fixture: "synthetic-response" });
        });
      const client = new XMattersClient({
        baseUrl: "https://example.xmatters.com",
        fetch,
        auth: op.authAction
          ? {
              type: "oauth",
              clientId: "test-client-id",
              username: "test-username",
              password: "test-password",
              refreshToken: "test-refresh-token",
            }
          : {
              type: "api-key",
              apiKey: "x-api-key-test-only",
              apiSecret: "test-secret-only",
            },
      });
      const args: Record<string, unknown> = {};
      if (op.pathParams.length)
        args.path = Object.fromEntries(
          op.pathParams.map((key) => [key, "fixture-" + key]),
        );
      if (op.requiredQueryParams.length)
        args.query = Object.fromEntries(
          op.requiredQueryParams.map((key) => [key, "fixture-query"]),
        );
      if (op.request === "json")
        args.body = Object.fromEntries(
          op.requiredBodyParams.map((key) => [key, "fixture-body"]),
        );
      if (op.request === "multipart")
        args.upload = { name: "fixture.txt", contentBase64: "dGVzdA==" };
      if (op.method !== "GET") args.confirm = true;
      const result = await executeOperation(op, args, client, true);
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0]!;
      const expectedPath = op.path.replace(/\{([^}]+)\}/g, (_, key: string) =>
        encodeURIComponent("fixture-" + key),
      );
      expect(new URL(String(url)).pathname).toBe(expectedPath);
      expect(init?.method).toBe(op.method);
      expect(init?.redirect).toBe("manual");
      if (op.request === "json")
        expect(JSON.parse(String(init?.body))).toEqual(args.body);
      if (op.request === "multipart")
        expect(init?.body).toBeInstanceOf(FormData);
      if (op.request === "form")
        expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe(
          op.authAction === "password" ? "password" : "refresh_token",
        );
      if (op.response === "binary")
        expect(result.structuredContent).toEqual({
          data: {
            contentBase64: Buffer.from("attachment fixture").toString("base64"),
            mimeType: "text/plain",
          },
        });
      expect(buildTool(op).name).toBe(op.id);
    },
  );
  it.each(operations.filter((op) => op.method !== "GET"))(
    "$id: cannot bypass read-only mode",
    async (op) => {
      const request = vi.fn();
      const result = await executeOperation(op, { confirm: true }, { request });
      expect(result.isError).toBe(true);
      expect(request).not.toHaveBeenCalled();
    },
  );
});
