import { afterEach, describe, expect, it, vi } from "vitest";
import {
  XMattersClient,
  XMattersError,
  type ApiRequest,
  type AuthConfig,
  type ClientOptions,
} from "../../src/client.js";

const BASE = "https://acme.xmatters.com";
const GET: ApiRequest = { method: "GET", path: "/api/xm/1/people" };
const BASIC: AuthConfig = {
  type: "basic",
  username: "test-user",
  password: "test-password",
};

function setup(options: Partial<ClientOptions> = {}) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ data: [] }));
  const client = new XMattersClient({
    baseUrl: BASE,
    auth: BASIC,
    fetch,
    ...options,
  });
  return { client, fetch };
}

function expectSafeError(error: unknown): asserts error is XMattersError {
  expect(error).toBeInstanceOf(XMattersError);
  if (!(error instanceof XMattersError))
    throw new Error("Expected a safe client error");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("XMattersClient", () => {
  it("makes a single authenticated JSON GET using native Basic credentials", async () => {
    const { client, fetch } = setup();
    await expect(client.request(GET)).resolves.toEqual({ data: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/api/xm/1/people`);
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("test-user:test-password").toString("base64")}`,
    );
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
  });

  it.each([
    [
      { type: "api-key", apiKey: "x-api-key-key", apiSecret: "secret" },
      `Basic ${Buffer.from("x-api-key-key:secret").toString("base64")}`,
    ],
    [{ type: "bearer", token: "supplied.token" }, "Bearer supplied.token"],
    [
      { type: "basic", username: "équipe", password: "p:ass" },
      `Basic ${Buffer.from("équipe:p:ass").toString("base64")}`,
    ],
  ] as [AuthConfig, string][])(
    "supports credential type %j without changing its secret",
    async (auth, expected) => {
      const { client, fetch } = setup({ auth });
      await client.request(GET);
      expect(
        new Headers(fetch.mock.calls[0]![1]?.headers).get("Authorization"),
      ).toBe(expected);
    },
  );
});

describe("tenant origin validation", () => {
  it.each([
    "http://acme.xmatters.com",
    "https://xmatters.com",
    "https://evil.example",
    "https://acme.xmatters.com.evil.example",
    "https://acme.xmatters.com:444",
    "https://user:secret@acme.xmatters.com",
    "https://@acme.xmatters.com",
    "https://acme.xmatters.com?token=secret",
    "https://acme.xmatters.com?",
    "https://acme.xmatters.com#",
    "https://acme.xmatters.com/api/xm/1",
    "https://acme.xmatters.com/../",
    "https://acme.xmatters.com/%2e/",
    "https://acme.xmatters.com\\@evil.example",
    " https://acme.xmatters.com",
    "https://acme.xmatters.com\n",
    "https://acme.xmatters.com.",
    "https://-bad.xmatters.com",
    "https://bad_.xmatters.com",
    "https://%61cme.xmatters.com",
    "https://acme..xmatters.com",
    "file:///etc/passwd",
    "not a URL",
  ])("rejects unsafe base URL %j before transport", (baseUrl) => {
    expect(() => setup({ baseUrl })).toThrow(XMattersError);
  });

  it("canonicalizes a valid regional HTTPS origin with the default port and trailing slash", async () => {
    const { client, fetch } = setup({
      baseUrl: "https://Acme.us.xmatters.com:443/",
    });
    await client.request(GET);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://acme.us.xmatters.com/api/xm/1/people",
    );
  });

  it("snapshots the configured tenant and keeps credentials out of client serialization", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({}));
    const auth: AuthConfig = { ...BASIC };
    const options: ClientOptions = { baseUrl: BASE, auth, fetch };
    const client = new XMattersClient(options);
    options.baseUrl = "https://different.xmatters.com";
    auth.password = "replacement";
    await client.request(GET);
    expect(String(fetch.mock.calls[0]![0])).toBe(`${BASE}${GET.path}`);
    expect(
      new Headers(fetch.mock.calls[0]![1]?.headers).get("Authorization"),
    ).toBe(
      `Basic ${Buffer.from("test-user:test-password").toString("base64")}`,
    );
    expect(JSON.stringify(client)).toBe("{}");
  });
});

describe("request path safety", () => {
  it.each([
    "",
    "api/xm/1/people",
    "https://evil.example/people",
    `${BASE}/api/xm/1/people`,
    "//evil.example/people",
    "/api//people",
    "/api/./people",
    "/api/../people",
    "/api/%2e/people",
    "/api/.%2e/people",
    "/api/%2E%2E/people",
    "/api/%252e%252e/people",
    "/api/people/a%2fb",
    "/api/people/a%5Cb",
    "/api/people/a%252Fb",
    "/api/people/a\\b",
    "/api/people?token=secret",
    "/api/people#secret",
    "/api/people/\nsecret",
    "/api/people/%00",
    "/api/people/%7f",
    "/api/people/%",
    "/api/people/%C0%AF",
    "/api/people/raw space",
    "/api/people/..;x",
    "/api/people/%3b",
  ])("rejects unsafe path %j before attaching credentials", async (path) => {
    const { client, fetch } = setup();
    await expect(client.request({ ...GET, path })).rejects.toBeInstanceOf(
      XMattersError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves properly encoded names and literal non-traversal dots", async () => {
    const { client, fetch } = setup();
    const path = "/api/xm/1/people/alice.smith%40example.com%20%C3%A9";
    await client.request({ ...GET, path });
    expect(String(fetch.mock.calls[0]![0])).toBe(`${BASE}${path}`);
  });
});

describe("query serialization", () => {
  it("serializes every query key with comma-delimited API arrays and preserves falsy values", async () => {
    const { client, fetch } = setup();
    const query = {
      search: "élève + ops & #?",
      offset: 0,
      enabled: false,
      empty: "",
      groups: ["DBA Admins", "IT"],
      types: [0, true, false],
      none: [],
      "property.name": "a/b",
    };
    await client.request({ ...GET, query });
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: query.search,
      offset: "0",
      enabled: "false",
      empty: "",
      groups: "DBA Admins,IT",
      types: "0,true,false",
      none: "",
      "property.name": "a/b",
    });
    expect(url.searchParams.getAll("groups")).toEqual(["DBA Admins,IT"]);
    expect(query.groups).toEqual(["DBA Admins", "IT"]);
  });

  it.each([null, undefined, NaN, Infinity, {}, [null], [["nested"]]])(
    "rejects out-of-contract query values %j rather than serializing them unsafely",
    async (value) => {
      const { client, fetch } = setup();
      await expect(
        client.request({ ...GET, query: { value } as ApiRequest["query"] }),
      ).rejects.toBeInstanceOf(XMattersError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "password",
    "access_token",
    "refresh_token",
    "apiKey",
    "api_secret",
    "client-secret",
    "Authorization",
    "token",
  ])("refuses credential-bearing query parameter %s", async (name) => {
    const { client, fetch } = setup();
    await expect(
      client.request({ ...GET, query: { [name]: "secret" } }),
    ).rejects.toBeInstanceOf(XMattersError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("JSON requests", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "sends an array JSON body with %s unchanged",
    async (method) => {
      const { client, fetch } = setup();
      const body = [
        { id: "one", value: false },
        { id: "two", value: 0 },
      ];
      await client.request({ ...GET, method, body });
      const init = fetch.mock.calls[0]![1]!;
      expect(init.method).toBe(method);
      expect(new Headers(init.headers).get("Content-Type")).toBe(
        "application/json",
      );
      expect(init.body).toBe(JSON.stringify(body));
    },
  );

  it.each([null, false, 0, "", { nested: { unicode: "é" } }])(
    "preserves a defined JSON body %j",
    async (body) => {
      const { client, fetch } = setup();
      await client.request({ ...GET, method: "POST", body });
      expect(fetch.mock.calls[0]![1]?.body).toBe(JSON.stringify(body));
    },
  );

  it("does not silently ignore a GET body", async () => {
    const { client, fetch } = setup();
    await expect(client.request({ ...GET, body: {} })).rejects.toBeInstanceOf(
      XMattersError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    1n,
    () => 1,
    Symbol("secret"),
    {
      toJSON() {
        throw new Error("test-password");
      },
    },
    (() => {
      const body: Record<string, unknown> = {};
      body.self = body;
      return body;
    })(),
  ])("sanitizes non-serializable JSON body errors %#", async (body) => {
    const { client, fetch } = setup();
    const error = await client
      .request({ ...GET, method: "POST", body })
      .catch((error) => error);
    expectSafeError(error);
    expect(error.message).not.toContain("test-password");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("safe HTTP failures", () => {
  it.each([
    301, 302, 303, 307, 308, 400, 401, 403, 404, 409, 422, 429, 500, 503,
  ])(
    "rejects HTTP %i once without exposing response text or headers",
    async (status) => {
      const { client, fetch } = setup();
      const cancel = vi.fn();
      fetch.mockResolvedValue(
        new Response(new ReadableStream({ cancel }), {
          status,
          statusText: "test-password",
          headers: {
            Location: "https://evil.example/?secret=test-password",
            "Retry-After": "10",
          },
        }),
      );
      const error = await client
        .request({ ...GET, method: "POST", body: {} })
        .catch((error) => error);
      expectSafeError(error);
      expect(error).toMatchObject({
        name: "XMattersError",
        status,
        code: status < 400 ? "REDIRECT_REJECTED" : "HTTP_ERROR",
      });
      expect(error.message).toContain(String(status));
      expect(`${error.message}${JSON.stringify(error)}`).not.toContain(
        "test-password",
      );
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("response");
      expect(error.retryAfter).toBe(
        status === 429 || status === 503 ? 10 : undefined,
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]![1]).toMatchObject({
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
    },
  );

  it.each([
    new Error("Authorization: Basic test-password"),
    Object.assign(new TypeError("test-password"), { cause: "test-password" }),
    "test-password",
  ])(
    "suppresses network exception details %# without retrying",
    async (reason) => {
      const { client, fetch } = setup();
      fetch.mockRejectedValue(reason);
      const error = await client.request(GET).catch((error) => error);
      expectSafeError(error);
      expect(error).toMatchObject({ code: "NETWORK_ERROR" });
      expect(`${error.message}${JSON.stringify(error)}`).not.toContain(
        "test-password",
      );
      expect(error).not.toHaveProperty("cause");
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { redirected: true, url: `${BASE}/api/xm/1/people` },
    { redirected: false, url: "https://other.xmatters.com/api/xm/1/people" },
  ])(
    "refuses a transport that already redirected or changed origins %#",
    async (properties) => {
      const { client, fetch } = setup();
      const response = Response.json({ secret: "test-password" });
      for (const [key, value] of Object.entries(properties))
        Object.defineProperty(response, key, { value });
      fetch.mockResolvedValue(response);
      await expect(client.request(GET)).rejects.toMatchObject({
        code: "REDIRECT_REJECTED",
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
});

describe("response decoding", () => {
  it.each([204, 205])("accepts an empty HTTP %i as null", async (status) => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response(null, { status }));
    await expect(client.request(GET)).resolves.toBeNull();
  });

  it("returns exact binary bytes and their MIME type without decoding text", async () => {
    const { client, fetch } = setup();
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    fetch.mockResolvedValue(
      new Response(bytes, { headers: { "Content-Type": "image/png" } }),
    );
    await expect(
      client.request({ ...GET, responseType: "binary" }),
    ).resolves.toEqual({
      contentBase64: Buffer.from(bytes).toString("base64"),
      mimeType: "image/png",
    });
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("Accept")).toBe(
      "*/*",
    );
  });

  it("uses an octet-stream MIME type for a typeless empty binary response", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response(new Uint8Array()));
    await expect(
      client.request({ ...GET, responseType: "binary" }),
    ).resolves.toEqual({
      contentBase64: "",
      mimeType: "application/octet-stream",
    });
  });

  it.each([
    ["<html>test-password</html>", "text/html"],
    ['{"test-password"', "application/json"],
    ["", "application/json"],
    ['{"test-password":"secret"}', "text/plain"],
  ])(
    "rejects unexpected or malformed JSON without reflecting its contents %#",
    async (body, contentType) => {
      const { client, fetch } = setup();
      fetch.mockResolvedValue(
        new Response(body, { headers: { "Content-Type": contentType } }),
      );
      const error = await client.request(GET).catch((error) => error);
      expectSafeError(error);
      expect(error).toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
      expect(`${error.message}${JSON.stringify(error)}`).not.toContain(
        "test-password",
      );
    },
  );

  it("does not expose a failed response stream exception", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("test-password"));
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const error = await client.request(GET).catch((error) => error);
    expectSafeError(error);
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    expect(error.message).not.toContain("test-password");
  });
});

describe("resource limits", () => {
  it.each(["timeoutMs", "maxResponseBytes", "maxUploadBytes"] as const)(
    "validates finite positive bounded integer %s",
    (key) => {
      for (const value of [0, -1, 1.5, NaN, Infinity, 2 ** 32]) {
        expect(() => setup({ [key]: value })).toThrow(XMattersError);
      }
    },
  );

  it("bounds UTF-8 request bytes before sending rather than counting characters", async () => {
    const { client, fetch } = setup({ maxUploadBytes: 8 });
    await expect(
      client.request({ ...GET, method: "POST", body: "éééé" }),
    ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a JSON body exactly at the byte limit", async () => {
    const { client, fetch } = setup({ maxUploadBytes: 8 });
    await client.request({ ...GET, method: "POST", body: "ééé" });
    expect(Buffer.byteLength(String(fetch.mock.calls[0]![1]?.body))).toBe(8);
  });

  it.each([
    { path: `/api/xm/1/people/${"a".repeat(17_000)}` },
    { query: { search: "a".repeat(17_000) } },
  ])(
    "bounds request URL length independently of upload size %#",
    async (extra) => {
      const { client, fetch } = setup();
      await expect(client.request({ ...GET, ...extra })).rejects.toMatchObject({
        code: "REQUEST_TOO_LARGE",
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["json", "binary"] as const)(
    "bounds streamed %s responses despite a false Content-Length",
    async (responseType) => {
      const { client, fetch } = setup({ maxResponseBytes: 5 });
      const cancel = vi.fn();
      fetch.mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.enqueue(new Uint8Array([4, 5, 6]));
            },
            cancel,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Content-Length": "1",
            },
          },
        ),
      );
      const outcome = client
        .request({ ...GET, responseType })
        .catch((error) => error);
      const settled = await Promise.race([
        outcome,
        new Promise((resolve) => setTimeout(() => resolve("stalled"), 100)),
      ]);
      expect(settled).toMatchObject({
        code: "RESPONSE_TOO_LARGE",
        status: 200,
      });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("rejects an oversized Content-Length before reading a stalled stream", async () => {
    const { client, fetch } = setup({ maxResponseBytes: 8 });
    const cancel = vi.fn();
    fetch.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { "Content-Length": "9", "Content-Type": "application/json" },
      }),
    );
    const outcome = client.request(GET).catch((error) => error);
    const settled = await Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(() => resolve("stalled"), 100)),
    ]);
    expect(settled).toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("counts chunks by bytes and permits exactly the response limit", async () => {
    const { client, fetch } = setup({ maxResponseBytes: 4 });
    fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("["));
            controller.enqueue(Buffer.from("10]"));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "application/json; charset=UTF-8" } },
      ),
    );
    await expect(client.request(GET)).resolves.toEqual([10]);
  });
});

describe("caller cancellation", () => {
  it("cancels a stalled body promptly and removes both caller and reader listeners", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const { client, fetch } = setup();
    const cancel = vi.fn(() => Promise.reject(new Error("test-password")));
    const response = new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(Buffer.from("{"));
        },
        cancel,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    fetch.mockResolvedValue(response);
    const settled = vi.fn();
    const outcome = client
      .request({ ...GET, signal: controller.signal })
      .catch((error) => {
        settled(error);
        return error;
      });
    await vi.advanceTimersByTimeAsync(0);
    const signal = fetch.mock.calls[0]![1]!.signal!;
    const removeReader = vi.spyOn(signal, "removeEventListener");
    controller.abort(new Error("test-password"));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CANCELLED" }),
    );
    const error = await outcome;
    expectSafeError(error);
    expect(error.message).not.toContain("test-password");
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body!.locked).toBe(false);
    expect(removeReader).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 401])(
    "removes the caller listener after HTTP %s without aborting it",
    async (status) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const { client, fetch } = setup();
      fetch.mockResolvedValue(Response.json({}, { status }));
      await client
        .request({ ...GET, signal: controller.signal })
        .catch(() => {});
      expect(controller.signal.aborted).toBe(false);
      expect(add).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
      expect(vi.getTimerCount()).toBe(0);
      controller.abort(new Error("too late"));
      expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    },
  );

  it("checks cancellation after synchronous body preparation before sending a write", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client, fetch } = setup();
    const body = {
      toJSON() {
        controller.abort(new Error("test-password"));
        return {};
      },
    };
    await expect(
      client.request({
        ...GET,
        method: "POST",
        body,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains TIMEOUT when caller cancellation follows the deadline", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client, fetch } = setup({ timeoutMs: 10 });
    let finish!: (response: Response) => void;
    fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const outcome = client
      .request({ ...GET, signal: controller.signal })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error("test-password"));
    finish(new Response(null, { status: 204 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toMatchObject({ code: "TIMEOUT" });
    expect(fetch.mock.calls[0]![1]!.signal!.reason).toMatchObject({
      code: "TIMEOUT",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([true, false])(
    "cancels pending fetch promptly (cooperative: %s)",
    async (cooperative) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const { client, fetch } = setup();
      let rejectFetch!: (error: unknown) => void;
      fetch.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            rejectFetch = reject;
            if (cooperative)
              init!.signal!.addEventListener(
                "abort",
                () => reject(init!.signal!.reason),
                { once: true },
              );
          }),
      );
      const settled = vi.fn();
      const outcome = client
        .request({ ...GET, signal: controller.signal })
        .catch((error) => {
          settled(error);
          return error;
        });
      controller.abort(new Error("test-password"));
      await vi.advanceTimersByTimeAsync(0);
      try {
        expect(settled).toHaveBeenCalledWith(
          expect.objectContaining({ code: "CANCELLED" }),
        );
        const error = await outcome;
        expectSafeError(error);
        expect(`${error.message}${JSON.stringify(error)}`).not.toContain(
          "test-password",
        );
        expect(error).not.toHaveProperty("cause");
        expect(fetch.mock.calls[0]![1]!.signal!.reason).toMatchObject({
          code: "CANCELLED",
        });
        expect(fetch).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
      } finally {
        rejectFetch(new Error("late test-password"));
        await outcome;
      }
    },
  );
  it("rejects a pre-aborted request without sending or reflecting its reason", async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup();
    const signal = AbortSignal.abort(new Error("test-password"));
    const error = await client
      .request({ ...GET, signal })
      .catch((error) => error);
    expectSafeError(error);
    expect(error).toMatchObject({ code: "CANCELLED" });
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain(
      "test-password",
    );
    expect(error).not.toHaveProperty("cause");
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("total request deadline", () => {
  it("times out even when fetch ignores AbortSignal and never settles", async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup({ timeoutMs: 50 });
    fetch.mockImplementation(() => new Promise(() => {}));
    const settled = vi.fn();
    const outcome = client.request(GET).catch((error) => {
      settled(error);
      return error;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ code: "TIMEOUT" }),
    );
    expect(await outcome).toBeInstanceOf(XMattersError);
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a single deadline through a stalled body, not a new timeout after headers", async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup({ timeoutMs: 50 });
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    fetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(
                  new ReadableStream({
                    start(controller) {
                      controller.enqueue(Buffer.from("{"));
                    },
                    cancel,
                  }),
                  { headers: { "Content-Type": "application/json" } },
                ),
              ),
            30,
          ),
        ),
    );
    const settled = vi.fn();
    const outcome = client.request(GET).catch((error) => {
      settled(error);
      return error;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ code: "TIMEOUT" }),
    );
    await outcome;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards a late fetch response after timeout without leaking or retaining its body", async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup({ timeoutMs: 10 });
    let resolve!: (response: Response) => void;
    fetch.mockImplementation(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );
    const settled = vi.fn();
    const outcome = client.request(GET).catch((error) => {
      settled(error);
      return error;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toHaveBeenCalled();
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(await outcome).toMatchObject({ code: "TIMEOUT" });
  });

  it.each([200, 401])(
    "clears deadline timers after HTTP %i completion",
    async (status) => {
      vi.useFakeTimers();
      const { client, fetch } = setup();
      fetch.mockResolvedValue(Response.json({}, { status }));
      await client.request(GET).catch(() => undefined);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("multipart uploads and form fields", () => {
  it("builds native multipart with UTF-8 fields and an in-memory file", async () => {
    const { client, fetch } = setup();
    await client.request({
      ...GET,
      method: "POST",
      upload: {
        name: "notes.txt",
        contentBase64: Buffer.from("Hello é").toString("base64"),
        mimeType: "text/plain",
      },
      fields: { description: "é & = +", empty: "" },
    });
    const init = fetch.mock.calls[0]![1]!;
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.name).toBe("notes.txt");
    expect(file.type).toBe("text/plain");
    expect(await file.text()).toBe("Hello é");
    expect(form.get("description")).toBe("é & = +");
    expect(form.get("empty")).toBe("");
  });

  it("supports custom multipart field names and an empty file with the default MIME type", async () => {
    const { client, fetch } = setup();
    await client.request({
      ...GET,
      method: "POST",
      upload: { name: "empty.bin", contentBase64: "", fieldName: "attachment" },
    });
    const file = (fetch.mock.calls[0]![1]?.body as FormData).get(
      "attachment",
    ) as File;
    expect(file.size).toBe(0);
    expect(file.type).toBe("application/octet-stream");
  });

  it("form-encodes standalone string fields without JSON or query credentials", async () => {
    const { client, fetch } = setup();
    const fields = { text: "a+b & é=ok", empty: "" };
    await client.request({ ...GET, method: "POST", fields });
    const init = fetch.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual(
      fields,
    );
  });

  it.each([
    "a",
    "YQ",
    "YQ=",
    "YQ===",
    "Y=Q=",
    "YQ==\n",
    "Y-__",
    "YR==",
    "data:text/plain;base64,YQ==",
    "!!!!",
  ])(
    "rejects non-canonical base64 %j without transport",
    async (contentBase64) => {
      const { client, fetch } = setup();
      await expect(
        client.request({
          ...GET,
          method: "POST",
          upload: { name: "file.bin", contentBase64 },
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: "../file" },
    { name: "C:\\file" },
    { name: "." },
    { name: "" },
    { name: "bad\r\nname" },
    { name: 'bad"name' },
    { fieldName: "bad\nname" },
    { fieldName: "" },
    { mimeType: "text/plain\r\nX-Foo: bar" },
    { mimeType: "not mime" },
  ])("rejects unsafe multipart metadata %#", async (metadata) => {
    const { client, fetch } = setup();
    await expect(
      client.request({
        ...GET,
        method: "POST",
        upload: { name: "safe.txt", contentBase64: "YQ==", ...metadata },
      }),
    ).rejects.toBeInstanceOf(XMattersError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { body: {}, fields: { text: "test" } },
    { body: [], upload: { name: "a", contentBase64: "YQ==" } },
    { method: "GET", fields: { text: "test" } },
    { method: "GET", upload: { name: "a", contentBase64: "YQ==" } },
    {
      fields: { file: "collision" },
      upload: { name: "a", contentBase64: "YQ==" },
    },
  ] as Partial<ApiRequest>[])(
    "rejects ambiguous or conflicting bodies %#",
    async (extra) => {
      const { client, fetch } = setup();
      await expect(
        client.request({ ...GET, method: "POST", ...extra }),
      ).rejects.toBeInstanceOf(XMattersError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { upload: { name: "a", contentBase64: "YWFhYWFhYWFh" } },
    { fields: { large: "éééé" } },
    {
      upload: { name: "a", contentBase64: "YQ==" },
      fields: { large: "a".repeat(1024) },
    },
  ] as Partial<ApiRequest>[])(
    "bounds encoded form and total multipart payload before sending %#",
    async (extra) => {
      const { client, fetch } = setup({ maxUploadBytes: 8 });
      await expect(
        client.request({ ...GET, method: "POST", ...extra }),
      ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

const TOKEN_PATH = "/api/xm/1/oauth2/token";
const PASSWORD_ACTION: ApiRequest = {
  method: "POST",
  path: TOKEN_PATH,
  authAction: "password",
};

describe("explicit OAuth password exchange", () => {
  it("exchanges configured credentials in a form, retains tokens, and returns only safe metadata", async () => {
    const auth: AuthConfig = {
      type: "oauth",
      clientId: "client+id",
      username: "u & é",
      password: "secret&=+",
    };
    const { client, fetch } = setup({ auth });
    fetch
      .mockResolvedValueOnce(
        Response.json({
          access_token: "acquired-token",
          refresh_token: "refresh-one",
          token_type: "bearer",
          expires_in: 588,
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: ["ok"] }));
    await expect(client.request(PASSWORD_ACTION)).resolves.toEqual({
      authenticated: true,
      expiresIn: 588,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}${TOKEN_PATH}`);
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual(
      {
        grant_type: "password",
        client_id: "client+id",
        username: "u & é",
        password: "secret&=+",
      },
    );
    await expect(client.request(GET)).resolves.toEqual({ data: ["ok"] });
    expect(
      new Headers(fetch.mock.calls[1]![1]?.headers).get("Authorization"),
    ).toBe("Bearer acquired-token");
    expect(JSON.stringify(client)).toBe("{}");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("requires an explicit action before authenticating an OAuth client", async () => {
    const { client, fetch } = setup({
      auth: { type: "oauth", clientId: "id", username: "u", password: "p" },
    });
    await expect(client.request(GET)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { auth: BASIC, request: PASSWORD_ACTION },
    { auth: { type: "oauth", clientId: "id" }, request: PASSWORD_ACTION },
    {
      auth: { type: "oauth", clientId: "id", username: "u", password: "p" },
      request: { ...PASSWORD_ACTION, path: GET.path },
    },
    {
      auth: { type: "oauth", clientId: "id", username: "u", password: "p" },
      request: { ...PASSWORD_ACTION, method: "GET" },
    },
    ...["body", "query", "fields", "upload"].map((key) => ({
      auth: { type: "oauth", clientId: "id", username: "u", password: "p" },
      request: { ...PASSWORD_ACTION, [key]: {} },
    })),
    {
      auth: { type: "oauth", clientId: "id", username: "u", password: "p" },
      request: { ...PASSWORD_ACTION, responseType: "binary" },
    },
  ] as { auth: AuthConfig; request: ApiRequest }[])(
    "rejects invalid or model-controlled OAuth exchange parameters %#",
    async ({ auth, request }) => {
      const { client, fetch } = setup({ auth });
      await expect(client.request(request)).rejects.toBeInstanceOf(
        XMattersError,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([TOKEN_PATH, `${TOKEN_PATH}/`, "/api/xm/1/oauth2/%74oken"])(
    "reserves the token endpoint %s for explicit auth actions",
    async (path) => {
      const { client, fetch } = setup();
      await expect(
        client.request({ method: "POST", path }),
      ).rejects.toBeInstanceOf(XMattersError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    [],
    null,
    { access_token: "" },
    { access_token: "bad\r\ntoken" },
    { access_token: "okay-token", token_type: "basic" },
    { access_token: "okay-token", expires_in: "secret" },
    { access_token: "okay-token", refresh_token: 123 },
  ])("suppresses malformed OAuth token responses %#", async (body) => {
    const { client, fetch } = setup({
      auth: { type: "oauth", clientId: "id", username: "u", password: "p" },
    });
    fetch.mockResolvedValue(Response.json(body));
    await expect(client.request(PASSWORD_ACTION)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(client.request(GET)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("explicit OAuth refresh", () => {
  it("refreshes with configured credentials and rotates tokens for subsequent requests", async () => {
    const { client, fetch } = setup({
      auth: {
        type: "oauth",
        clientId: "client-id",
        refreshToken: "configured+refresh&",
      },
    });
    fetch
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access-one",
          refresh_token: "refresh-two",
          expires_in: 60,
        }),
      )
      .mockResolvedValueOnce(Response.json({ access_token: "access-two" }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const refresh: ApiRequest = {
      method: "POST",
      path: TOKEN_PATH,
      authAction: "refresh",
    };
    await expect(client.request(refresh)).resolves.toEqual({
      authenticated: true,
      expiresIn: 60,
    });
    await expect(client.request(refresh)).resolves.toEqual({
      authenticated: true,
    });
    expect(
      Object.fromEntries(
        new URLSearchParams(String(fetch.mock.calls[0]![1]?.body)),
      ),
    ).toEqual({
      grant_type: "refresh_token",
      client_id: "client-id",
      refresh_token: "configured+refresh&",
    });
    expect(
      Object.fromEntries(
        new URLSearchParams(String(fetch.mock.calls[1]![1]?.body)),
      ),
    ).toEqual({
      grant_type: "refresh_token",
      client_id: "client-id",
      refresh_token: "refresh-two",
    });
    await client.request(GET);
    expect(
      new Headers(fetch.mock.calls[2]![1]?.headers).get("Authorization"),
    ).toBe("Bearer access-two");
  });

  it("refreshes an acquired token without ever automatically retrying an unauthorized request", async () => {
    const { client, fetch } = setup({
      auth: { type: "oauth", clientId: "id", username: "u", password: "p" },
    });
    fetch
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access-one",
          refresh_token: "refresh-one",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "access-one" }, { status: 401 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access-two",
          refresh_token: "refresh-two",
        }),
      );
    await client.request(PASSWORD_ACTION);
    await expect(client.request(GET)).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
    await client.request({ ...PASSWORD_ACTION, authAction: "refresh" });
    expect(
      new URLSearchParams(String(fetch.mock.calls[2]![1]?.body)).get(
        "refresh_token",
      ),
    ).toBe("refresh-one");
  });

  it("requires a configured or previously acquired refresh token", async () => {
    const { client, fetch } = setup({
      auth: { type: "oauth", clientId: "id" },
    });
    await expect(
      client.request({ ...PASSWORD_ACTION, authAction: "refresh" }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not lose the current access token on a malformed refresh response", async () => {
    const { client, fetch } = setup({
      auth: { type: "oauth", clientId: "id", refreshToken: "refresh-one" },
    });
    fetch
      .mockResolvedValueOnce(Response.json({ access_token: "current-access" }))
      .mockResolvedValueOnce(
        Response.json({ access_token: "replacement", refresh_token: 7 }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await client.request({ ...PASSWORD_ACTION, authAction: "refresh" });
    await expect(
      client.request({ ...PASSWORD_ACTION, authAction: "refresh" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await client.request(GET);
    expect(
      new Headers(fetch.mock.calls[2]![1]?.headers).get("Authorization"),
    ).toBe("Bearer current-access");
  });
});

describe("success response credential protection", () => {
  it.each([
    { type: "basic", username: "private-user", password: "private-password" },
    {
      type: "api-key",
      apiKey: "x-api-key-private-key",
      apiSecret: "private-secret",
    },
    { type: "bearer", token: "private-token" },
  ] as AuthConfig[])(
    "redacts actual configured values recursively without dropping unrelated field names (%j)",
    async (auth) => {
      const { client, fetch } = setup({ auth });
      const secrets = Object.entries(auth)
        .filter(([key]) => key !== "type")
        .map(([, value]) => value);
      fetch.mockResolvedValue(
        Response.json({
          config: { theme: "dark" },
          password: "public documentation",
          token: "public example",
          echoes: secrets.map((secret) => ({
            message: `before ${secret} after`,
            [secret]: secret,
          })),
        }),
      );
      const result = await client.request(GET);
      expect(result).toMatchObject({
        config: { theme: "dark" },
        password: "public documentation",
        token: "public example",
      });
      for (const secret of secrets)
        expect(JSON.stringify(result)).not.toContain(secret);
      expect(result).toMatchObject({
        echoes: secrets.map(() => ({
          message: "before [REDACTED] after",
          "[REDACTED]": "[REDACTED]",
        })),
      });
    },
  );

  it("redacts Basic wire encodings and percent/form/base64 encoded secret echoes", async () => {
    const password = "secret & + /";
    const { client, fetch } = setup({
      auth: { type: "basic", username: "private-user", password },
    });
    const encoded = [
      `Basic ${Buffer.from(`private-user:${password}`).toString("base64")}`,
      encodeURIComponent(password),
      new URLSearchParams({ value: password })
        .toString()
        .slice("value=".length),
      Buffer.from(password).toString("base64"),
    ];
    fetch.mockResolvedValue(Response.json(encoded));
    const result = await client.request(GET);
    for (const echo of encoded)
      expect(JSON.stringify(result)).not.toContain(echo);
    expect(result).toEqual([
      "[REDACTED]",
      "[REDACTED]",
      "[REDACTED]",
      "[REDACTED]",
    ]);
  });

  it("retains a redaction set for issued access and refresh tokens after rotation", async () => {
    const { client, fetch } = setup({
      auth: {
        type: "oauth",
        clientId: "private-client",
        refreshToken: "configured-refresh",
      },
    });
    fetch
      .mockResolvedValueOnce(
        Response.json({
          access_token: "issued-access",
          refresh_token: "issued-refresh",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          echo: [
            "issued-access",
            "issued-refresh",
            "rotated-access",
            "rotated-refresh",
            "configured-refresh",
            "private-client",
          ],
        }),
      );
    await client.request({ ...PASSWORD_ACTION, authAction: "refresh" });
    await client.request({ ...PASSWORD_ACTION, authAction: "refresh" });
    await expect(client.request(GET)).resolves.toEqual({
      echo: Array(6).fill("[REDACTED]"),
    });
  });

  it.each(["bytes", "mime"] as const)(
    "suppresses credential-bearing binary %s rather than corrupting an attachment",
    async (where) => {
      const { client, fetch } = setup({
        auth: { type: "bearer", token: "private-token" },
      });
      fetch.mockResolvedValue(
        new Response(
          Buffer.from(where === "bytes" ? "\0private-token\0" : "safe"),
          {
            headers: {
              "Content-Type":
                where === "mime"
                  ? "application/private-token"
                  : "application/octet-stream",
            },
          },
        ),
      );
      await expect(
        client.request({ ...GET, responseType: "binary" }),
      ).rejects.toMatchObject({ code: "SENSITIVE_RESPONSE" });
    },
  );

  it("redacts numerically echoed credentials without prototype pollution", async () => {
    const { client, fetch } = setup({
      auth: { type: "bearer", token: "12345678" },
    });
    fetch.mockResolvedValue(
      new Response(
        '{"__proto__":{"value":"12345678"},"number":12345678,"safe":true}',
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = (await client.request(GET)) as Record<string, unknown>;
    expect(result.number).toBe("[REDACTED]");
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result.__proto__).toEqual({ value: "[REDACTED]" });
    expect(Object.prototype).not.toHaveProperty("value");
  });
});

describe("runtime input validation", () => {
  it.each([
    { type: "basic", username: "", password: "secret" },
    { type: "basic", username: "bad:user", password: "secret" },
    { type: "basic", username: "user", password: "" },
    { type: "basic", username: "user", password: "\ud800" },
    { type: "api-key", apiKey: "bad:key", apiSecret: "secret" },
    { type: "api-key", apiKey: "x-api-key-", apiSecret: "secret" },
    { type: "bearer", token: "bad\r\nheader" },
    { type: "bearer", token: "" },
    { type: "bearer", token: "bad token" },
    { type: "bearer", token: "a".repeat(17_000) },
    { type: "oauth", clientId: "" },
    { type: "oauth", clientId: "client", refreshToken: "" },
    { type: "oauth", clientId: "client", password: 123 },
    { type: "unknown" },
  ])(
    "rejects invalid credential configuration %# with a safe error",
    (auth) => {
      try {
        setup({ auth: auth as AuthConfig });
        expect.fail("Expected invalid credentials to be rejected");
      } catch (error) {
        expectSafeError(error);
        expect(error.message).not.toContain("bad");
        expect(error.message).not.toContain("secret");
      }
    },
  );

  it.each([
    { method: "TRACE" },
    { method: "get" },
    { responseType: "text" },
    { fields: { key: 1 } },
    { fields: { "bad\nname": "value" } },
    { upload: { name: 4, contentBase64: "YQ==" } },
    { upload: { name: "file", contentBase64: 42 } },
  ])(
    "rejects runtime request contract violations %# before fetch",
    async (extra) => {
      const { client, fetch } = setup();
      await expect(
        client.request({ ...GET, method: "POST", ...extra } as ApiRequest),
      ).rejects.toBeInstanceOf(XMattersError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects unsupported OAuth actions even when valid credentials are configured", async () => {
    const { client, fetch } = setup({
      auth: {
        type: "oauth",
        clientId: "id",
        username: "user",
        password: "pass",
      },
    });
    await expect(
      client.request({
        ...PASSWORD_ACTION,
        authAction: "other",
      } as unknown as ApiRequest),
    ).rejects.toBeInstanceOf(XMattersError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "/api/%EF%BC%8E%EF%BC%8E/people",
    "/api/people/a%EF%BC%8Fb",
    "/api/people/a%EF%BC%BCb",
  ])("rejects NFKC-normalized separator/traversal tricks %s", async (path) => {
    const { client, fetch } = setup();
    await expect(client.request({ ...GET, path })).rejects.toBeInstanceOf(
      XMattersError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("deadline and response hardening", () => {
  it("includes request serialization time in the deadline before sending", async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup({ timeoutMs: 10 });
    const body = {
      toJSON() {
        vi.advanceTimersByTime(20);
        return {};
      },
    };
    await expect(
      client.request({ ...GET, method: "POST", body }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks elapsed time even when a ready promise outruns the timer callback", async () => {
    vi.useFakeTimers();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const { client, fetch } = setup({ timeoutMs: 50 });
    fetch.mockImplementation(async () => {
      clock.mockReturnValue(100);
      return Response.json({ ok: true });
    });
    await expect(client.request(GET)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects invalid UTF-8 rather than silently changing successful JSON data", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      new Response(new Uint8Array([34, 255, 34]), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(client.request(GET)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("accepts a UTF-8 BOM and a structured JSON media type", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      new Response('\ufeff{"ok":true}', {
        headers: { "Content-Type": "application/vnd.xmatters+json" },
      }),
    );
    await expect(client.request(GET)).resolves.toEqual({ ok: true });
  });

  it("safely rejects already-locked response streams", async () => {
    const { client, fetch } = setup();
    const response = Response.json({ data: [] });
    const reader = response.body!.getReader();
    fetch.mockResolvedValue(response);
    await expect(client.request(GET)).rejects.toMatchObject({
      name: "XMattersError",
      code: "NETWORK_ERROR",
    });
    reader.releaseLock();
  });

  it("bounds JSON traversal depth before redaction", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      new Response("[".repeat(100) + "0" + "]".repeat(100), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(client.request(GET)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it.each([
    { access_token: "a".repeat(17_000) },
    { access_token: "new-access", refresh_token: "\ud800" },
    { access_token: "new-access", refresh_token: "bad\r\nrefresh" },
  ])(
    "rejects malformed or excessive token data atomically %#",
    async (payload) => {
      const { client, fetch } = setup({
        auth: {
          type: "oauth",
          clientId: "id",
          username: "user",
          password: "pass",
        },
      });
      fetch.mockResolvedValue(Response.json(payload));
      await expect(client.request(PASSWORD_ACTION)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
      await expect(client.request(GET)).rejects.toMatchObject({
        code: "AUTH_REQUIRED",
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
});

describe("OAuth state isolation", () => {
  it("snapshots request controls so caller mutation cannot expose a token response", async () => {
    const { client, fetch } = setup({
      auth: {
        type: "oauth",
        clientId: "id",
        username: "user",
        password: "pass",
      },
    });
    let resolve!: (response: Response) => void;
    fetch
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolve = res;
          }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const request = { ...PASSWORD_ACTION };
    const outcome = client.request(request);
    delete request.authAction;
    request.responseType = "binary";
    resolve(
      Response.json({
        access_token: "must-stay-private",
        refresh_token: "also-private",
      }),
    );
    await expect(outcome).resolves.toEqual({ authenticated: true });
    await client.request(GET);
    expect(
      new Headers(fetch.mock.calls[1]![1]?.headers).get("Authorization"),
    ).toBe("Bearer must-stay-private");
  });

  it("serializes token-state changes by refusing concurrent exchanges and releases the guard on failure", async () => {
    const { client, fetch } = setup({
      auth: { type: "oauth", clientId: "id", refreshToken: "refresh-one" },
    });
    let resolve!: (response: Response) => void;
    fetch
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolve = res;
          }),
      )
      .mockResolvedValueOnce(Response.json({ access_token: "new-access" }));
    const request: ApiRequest = { ...PASSWORD_ACTION, authAction: "refresh" };
    const first = client.request(request).catch((error) => error);
    await expect(client.request(request)).rejects.toMatchObject({
      code: "AUTH_IN_PROGRESS",
    });
    expect(fetch).toHaveBeenCalledOnce();
    resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
    expect(await first).toMatchObject({ status: 400 });
    await expect(client.request(request)).resolves.toEqual({
      authenticated: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("response boundary failures", () => {
  it("does not trust a transport-created XMattersError as a safe stream exception", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(
              new XMattersError("test-password", { code: "test-password" }),
            );
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const error = await client.request(GET).catch((error) => error);
    expectSafeError(error);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain(
      "test-password",
    );
  });

  it("suppresses a malformed response URL instead of exposing the URL parser error", async () => {
    const { client, fetch } = setup();
    const response = Response.json({});
    Object.defineProperty(response, "url", {
      value: "not a URL test-password",
    });
    fetch.mockResolvedValue(response);
    const error = await client.request(GET).catch((error) => error);
    expectSafeError(error);
    expect(error.code).toBe("REDIRECT_REJECTED");
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain(
      "test-password",
    );
  });
});

describe("transport regression checks", () => {
  it("uses the native fetch default without making an unmocked tenant request", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      new XMattersClient({ baseUrl: BASE, auth: BASIC }).request(GET),
    ).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns pagination metadata untouched and fetches only the requested offset", async () => {
    const { client, fetch } = setup();
    const page = {
      data: [],
      total: 1000,
      links: { next: "https://evil.example/next" },
    };
    fetch.mockResolvedValue(Response.json(page));
    await expect(
      client.request({ ...GET, query: { offset: 100, limit: 10 } }),
    ).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledOnce();
    expect(
      new URL(String(fetch.mock.calls[0]![0])).searchParams.get("offset"),
    ).toBe("100");
  });

  it("handles a null binary body without assuming a stream is present", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response(null));
    await expect(
      client.request({ ...GET, responseType: "binary" }),
    ).resolves.toEqual({
      contentBase64: "",
      mimeType: "application/octet-stream",
    });
  });

  it("escapes regular-expression metacharacters in actual credentials", async () => {
    const password = "s3.[*]+(x)?$^|\\end";
    const { client, fetch } = setup({
      auth: { type: "basic", username: "private-user", password },
    });
    fetch.mockResolvedValue(
      Response.json({ exact: password, unrelated: "s3anything" }),
    );
    await expect(client.request(GET)).resolves.toEqual({
      exact: "[REDACTED]",
      unrelated: "s3anything",
    });
  });

  it.each(["test-password", "-1", "1.5", "9".repeat(30)])(
    "does not expose an unsafe Retry-After header %j",
    async (retryAfter) => {
      const { client, fetch } = setup();
      fetch.mockResolvedValue(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": retryAfter },
        }),
      );
      await expect(client.request(GET)).rejects.toMatchObject({
        code: "HTTP_ERROR",
        status: 429,
        retryAfter: undefined,
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("handles cancellation failures without leaking them or masking the HTTP error", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel() {
            return Promise.reject(new Error("test-password"));
          },
        }),
        { status: 503 },
      ),
    );
    await expect(client.request(GET)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 503,
    });
  });

  it("maps native fetch abort rejection to TIMEOUT rather than NETWORK_ERROR", async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup({ timeoutMs: 10 });
    fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error("test-password")),
            { once: true },
          );
        }),
    );
    const outcome = client.request(GET).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toMatchObject({ code: "TIMEOUT" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("bounds an excessively encoded upload before allocating decoded bytes", async () => {
    const { client, fetch } = setup({ maxUploadBytes: 8 });
    await expect(
      client.request({
        ...GET,
        method: "POST",
        upload: { name: "a", contentBase64: "a".repeat(1024) },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
