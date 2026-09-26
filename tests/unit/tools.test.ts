import { describe, it, expect, vi } from "vitest";
import { XMattersError } from "../../src/client.js";
import {
  buildTool,
  executeOperation,
  type Operation,
} from "../../src/tools.js";

export const person: Operation = {
  id: "xmatters_get_person",
  title: "Get a person",
  group: "PEOPLE",
  method: "GET",
  path: "/api/xm/1/people/{personId}",
  docsUrl: "https://help.xmatters.com/xmapi/#get-a-person-by-id",
  request: "none",
  response: "json",
  pathParams: ["personId"],
  queryParams: ["embed"],
  bodyParams: [],
  requiredQueryParams: [],
  requiredBodyParams: [],
};

describe("tool dispatch", () => {
  it("returns safe typed transport error metadata without suppressing status or retry guidance", async () => {
    const request = vi.fn().mockRejectedValue(
      new XMattersError("Rate limited; not retried", {
        code: "HTTP_ERROR",
        status: 429,
        retryAfter: 15,
      }),
    );
    const result = await executeOperation(
      person,
      { path: { personId: "one" } },
      { request },
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: "Rate limited; not retried",
      code: "HTTP_ERROR",
      status: 429,
      retryAfter: 15,
    });
  });
  it("encodes an ID as one segment and passes query values unchanged to the client", async () => {
    const request = vi.fn().mockResolvedValue({ id: "person-1" });
    const result = await executeOperation(
      person,
      {
        path: { personId: "User One" },
        query: { embed: ["devices", "roles"], limit: 25, enabled: true },
      },
      { request },
    );
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/xm/1/people/User%20One",
      query: { embed: ["devices", "roles"], limit: 25, enabled: true },
      responseType: "json",
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ data: { id: "person-1" } });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ data: { id: "person-1" } }) },
    ]);
  });
  it.each([
    {},
    { path: {} },
    { path: { personId: "" } },
    { path: { personId: ".." } },
    { path: { personId: "." } },
    { path: { personId: "a/b" } },
    { path: { personId: "a\\b" } },
    { path: { personId: "%2e%2e" } },
    { path: { personId: "ok", unknown: "bad" } },
    { path: { personId: "ok" }, url: "https://attacker.invalid" },
    { path: { personId: "ok" }, query: { bad: { nested: true } } },
    { path: { personId: "ok" }, body: {} },
  ])(
    "rejects invalid or unsafe arguments before making a request: %j",
    async (args) => {
      const request = vi.fn();
      const result = await executeOperation(person, args, { request });
      expect(result.isError).toBe(true);
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("validates required query parameters", async () => {
    const op = { ...person, requiredQueryParams: ["eventId"] };
    const request = vi.fn().mockResolvedValue({ data: [] });
    expect(
      (await executeOperation(op, { path: { personId: "one" } }, { request }))
        .isError,
    ).toBe(true);
    expect(
      (
        await executeOperation(
          op,
          { path: { personId: "one" }, query: { eventId: "event" } },
          { request },
        )
      ).isError,
    ).not.toBe(true);
  });
  it("returns a safe failure without echoing an unexpected error or credentials", async () => {
    const request = vi.fn().mockRejectedValue(new Error("secret-do-not-echo"));
    const result = await executeOperation(
      person,
      { path: { personId: "one" } },
      { request },
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-do-not-echo");
  });
});

const create: Operation = {
  ...person,
  id: "xmatters_create_person",
  title: "Create a person",
  method: "POST",
  path: "/api/xm/1/people",
  pathParams: [],
  request: "json",
  bodyParams: ["targetName"],
  requiredBodyParams: ["targetName"],
};

describe("write safety and encodings", () => {
  it("requires both operator write enablement and explicit per-call confirmation", async () => {
    const request = vi.fn().mockResolvedValue({ id: "new" });
    expect(
      (
        await executeOperation(
          create,
          { body: { targetName: "new" }, confirm: true },
          { request },
        )
      ).isError,
    ).toBe(true);
    expect(
      (
        await executeOperation(
          create,
          { body: { targetName: "new" } },
          { request },
          true,
        )
      ).isError,
    ).toBe(true);
    expect(
      (
        await executeOperation(
          create,
          { body: { targetName: "new" }, confirm: false },
          { request },
          true,
        )
      ).isError,
    ).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(
      (
        await executeOperation(
          create,
          {
            body: {
              targetName: "new",
              nested: { roles: ["role"] },
              futureField: true,
            },
            confirm: true,
          },
          { request },
          true,
        )
      ).isError,
    ).not.toBe(true);
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/xm/1/people",
      body: {
        targetName: "new",
        nested: { roles: ["role"] },
        futureField: true,
      },
      responseType: "json",
    });
  });
  it("requires a JSON body and documented required top-level body fields", async () => {
    const request = vi.fn();
    for (const args of [
      { confirm: true },
      { confirm: true, body: {} },
      { confirm: true, body: null },
    ]) {
      expect(
        (await executeOperation(create, args, { request }, true)).isError,
      ).toBe(true);
    }
    expect(request).not.toHaveBeenCalled();
  });
  it("allows JSON array payloads for bulk endpoints without imposing invented fields", async () => {
    const request = vi.fn().mockResolvedValue([]);
    expect(
      (
        await executeOperation(
          { ...create, requiredBodyParams: [] },
          { body: [{ id: "one" }], confirm: true },
          { request },
          true,
        )
      ).isError,
    ).not.toBe(true);
    expect(request.mock.calls[0]?.[0].body).toEqual([{ id: "one" }]);
  });
  it("dispatches multipart content and scalar form fields", async () => {
    const request = vi.fn().mockResolvedValue({ id: "upload" });
    const upload = {
      name: "users.csv",
      contentBase64: "dGVzdA==",
      mimeType: "text/csv",
    };
    const op: Operation = {
      ...create,
      request: "multipart",
      requiredBodyParams: ["file"],
    };
    const args = { upload, fields: { name: "Import" }, confirm: true };
    expect(
      (await executeOperation(op, args, { request }, true)).isError,
    ).not.toBe(true);
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/xm/1/people",
      upload,
      fields: { name: "Import" },
      responseType: "json",
    });
    expect(
      (await executeOperation(op, { confirm: true }, { request }, true))
        .isError,
    ).toBe(true);
  });
  it("dispatches DELETE without requiring a JSON body", async () => {
    const request = vi.fn().mockResolvedValue(null);
    const op: Operation = { ...person, method: "DELETE" };
    expect(
      (
        await executeOperation(
          op,
          { path: { personId: "one" }, confirm: true },
          { request },
          true,
        )
      ).isError,
    ).not.toBe(true);
    expect(request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/xm/1/people/one",
      responseType: "json",
    });
  });
  it("uses configured OAuth credentials rather than model-supplied token bodies", async () => {
    const request = vi.fn().mockResolvedValue({ authenticated: true });
    const op: Operation = {
      ...create,
      path: "/api/xm/1/oauth2/token",
      request: "form",
      authAction: "refresh",
    };
    expect(
      (await executeOperation(op, { confirm: true }, { request }, true))
        .isError,
    ).not.toBe(true);
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/xm/1/oauth2/token",
      authAction: "refresh",
      responseType: "json",
    });
    expect(
      (
        await executeOperation(
          op,
          { confirm: true, body: { refresh_token: "no" } },
          { request },
          true,
        )
      ).isError,
    ).toBe(true);
  });
});

describe("tool discovery", () => {
  it("advertises unconditional query requirements without closing the field set", () => {
    const tool = buildTool({ ...person, requiredQueryParams: ["groups"] });
    expect(tool.inputSchema.properties?.query).toMatchObject({
      type: "object",
      required: ["groups"],
    });
    expect(
      (tool.inputSchema.properties?.query as { additionalProperties: unknown })
        .additionalProperties,
    ).not.toBe(false);
  });
  it("advertises unconditional body keys while permitting arbitrary nested API fields", () => {
    const tool = buildTool(create);
    expect(tool.inputSchema.properties?.body).toMatchObject({
      type: "object",
      required: ["targetName"],
    });
    expect(
      (tool.inputSchema.properties?.body as { additionalProperties: unknown })
        .additionalProperties,
    ).not.toBe(false);
  });
  it("advertises query fields, mutation confirmation, body and multipart inputs consistently", () => {
    expect(buildTool(person).inputSchema.properties?.query).toBeDefined();
    const tool = buildTool(create);
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(["body", "confirm"]),
    );
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.description).toContain("targetName");
    const multipart = buildTool({ ...create, request: "multipart" });
    expect(multipart.inputSchema.required).toContain("upload");
    const oauth = buildTool({
      ...create,
      request: "form",
      authAction: "password",
    });
    expect(oauth.inputSchema.properties?.body).toBeUndefined();
  });
  it("advertises the endpoint, required path fields and safe MCP annotations", () => {
    const tool = buildTool(person);
    expect(tool.name).toBe(person.id);
    expect(tool.description).toContain("GET /api/xm/1/people/{personId}");
    expect(tool.description).toContain(person.docsUrl);
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(tool.inputSchema.required).toEqual(["path"]);
    expect(tool.inputSchema.properties?.path).toMatchObject({
      type: "object",
      required: ["personId"],
      additionalProperties: false,
    });
  });
});
