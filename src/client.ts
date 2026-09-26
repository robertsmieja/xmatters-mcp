export type AuthConfig =
  | { type: "api-key"; apiKey: string; apiSecret: string }
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string }
  | {
      type: "oauth";
      clientId: string;
      username?: string;
      password?: string;
      refreshToken?: string;
    };

export interface ClientOptions {
  baseUrl: string;
  auth: AuthConfig;
  fetch?: typeof globalThis.fetch;
  /** Total request deadline, including preparation and streamed response reads (default: 30 seconds). */
  timeoutMs?: number;
  /** Maximum decoded response bytes (default: 2 MiB; configurable up to 100 MiB). */
  maxResponseBytes?: number;
  /** Maximum request body bytes, including a conservative multipart overhead bound (default: 10 MiB). */
  maxUploadBytes?: number;
}

export interface ApiRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<
    string,
    string | number | boolean | (string | number | boolean)[]
  >;
  body?: unknown;
  upload?: {
    name: string;
    contentBase64: string;
    mimeType?: string;
    fieldName?: string;
  };
  fields?: Record<string, string>;
  responseType?: "json" | "binary";
  authAction?: "password" | "refresh";
}

/** Safe, structured failures. Never retains a raw response, body, URL, or cause. */
export class XMattersError extends Error {
  readonly code: string;
  readonly status?: number;
  /** Valid nonnegative Retry-After delta-seconds, when supplied for HTTP 429 or 503. */
  readonly retryAfter?: number;

  constructor(
    message: string,
    details: { code?: string; status?: number; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = "XMattersError";
    this.code = details.code ?? "INVALID_REQUEST";
    this.status = details.status;
    this.retryAfter = details.retryAfter;
  }
}

function validCredential(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value) > 8192 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function validateAuth(auth: AuthConfig): void {
  const invalid = () =>
    new XMattersError("Invalid authentication configuration");
  if (!auth || typeof auth !== "object") throw invalid();
  switch (auth.type) {
    case "basic":
      if (
        !validCredential(auth.username) ||
        auth.username.includes(":") ||
        !validCredential(auth.password)
      )
        throw invalid();
      return;
    case "api-key":
      if (
        !validCredential(auth.apiKey) ||
        !auth.apiKey.startsWith("x-api-key-") ||
        auth.apiKey.includes(":") ||
        auth.apiKey === "x-api-key-" ||
        !validCredential(auth.apiSecret)
      )
        throw invalid();
      return;
    case "bearer":
      if (!validCredential(auth.token) || !BEARER_TOKEN.test(auth.token))
        throw invalid();
      return;
    case "oauth":
      if (!validCredential(auth.clientId)) throw invalid();
      for (const value of [auth.username, auth.password, auth.refreshToken]) {
        if (value !== undefined && !validCredential(value)) throw invalid();
      }
      return;
    default:
      throw invalid();
  }
}

function validatePath(path: string): void {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.includes("//") ||
    /[\\?#;\s\x00-\x1f\x7f]/.test(path)
  ) {
    throw new XMattersError("Invalid request path");
  }
  for (const segment of path.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment).normalize("NFKC");
    } catch {
      throw new XMattersError("Invalid request path");
    }
    // Reject nested encoding so no downstream decoder can reveal separators or traversal.
    if (
      decoded === "." ||
      decoded === ".." ||
      /[%/\\;\x00-\x1f\x7f]/.test(decoded)
    ) {
      throw new XMattersError("Invalid request path");
    }
  }
}

const TOKEN_PATH = "/api/xm/1/oauth2/token";
const BEARER_TOKEN = /^[A-Za-z0-9._~+\/-]+=*$/;
const MAX_URL_BYTES = 16 * 1024;
const MAX_BUFFER_BYTES = 100 * 1024 * 1024;

type ResolvedOptions = ClientOptions &
  Required<
    Pick<ClientOptions, "timeoutMs" | "maxResponseBytes" | "maxUploadBytes">
  >;

function limit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) {
    throw new XMattersError(
      "Resource limits must be positive bounded integers",
    );
  }
  return result;
}

function timeoutError(): XMattersError {
  return new XMattersError(
    "xMatters request timed out; the request was not retried",
    { code: "TIMEOUT" },
  );
}

interface Deadline {
  signal: AbortSignal;
  check(): void;
}

async function withDeadline<T>(
  expiresAt: number,
  operation: (deadline: Deadline) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const expire = () => {
    const error = timeoutError();
    controller.abort(error);
    return error;
  };
  const deadline: Deadline = {
    signal: controller.signal,
    check: () => {
      if (controller.signal.aborted || performance.now() >= expiresAt)
        throw expire();
    },
  };
  deadline.check();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(expire()), expiresAt - performance.now());
  });
  try {
    const result = await Promise.race([operation(deadline), timeout]);
    deadline.check();
    return result;
  } finally {
    clearTimeout(timer!);
  }
}

async function readResponse(
  response: Response,
  maximum: number,
  deadline: Deadline,
): Promise<Buffer> {
  const { signal } = deadline;
  const tooLarge = new XMattersError(
    "xMatters response exceeds the byte limit",
    {
      code: "RESPONSE_TOO_LARGE",
      status: response.status,
    },
  );
  const declared = response.headers.get("Content-Length");
  if (
    declared !== null &&
    /^\d+$/.test(declared) &&
    Number(declared) > maximum
  ) {
    void response.body?.cancel().catch(() => {});
    throw tooLarge;
  }
  if (!response.body) return Buffer.alloc(0);
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    throw new XMattersError("xMatters response stream is unavailable", {
      code: "NETWORK_ERROR",
      status: response.status,
    });
  }
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      deadline.check();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw tooLarge;
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error === tooLarge) throw error;
    if (signal.aborted) throw timeoutError();
    throw new XMattersError("xMatters response stream failed", {
      code: "NETWORK_ERROR",
      status: response.status,
    });
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function requestTooLarge(): XMattersError {
  return new XMattersError("Request body exceeds the byte limit", {
    code: "REQUEST_TOO_LARGE",
  });
}

function buildBody(
  request: ApiRequest,
  maximum: number,
): { body?: BodyInit; contentType?: string } {
  const { upload, fields } = request;
  if (
    fields !== undefined &&
    (fields === null ||
      typeof fields !== "object" ||
      Array.isArray(fields) ||
      Object.entries(fields).some(
        ([key, value]) =>
          !/^[a-zA-Z0-9_.-]{1,128}$/.test(key) || typeof value !== "string",
      ))
  ) {
    throw new XMattersError("Form fields require safe names and string values");
  }
  if (
    request.method === "GET" &&
    (request.body !== undefined || upload !== undefined || fields !== undefined)
  ) {
    throw new XMattersError("GET requests cannot contain a body");
  }
  if (
    request.body !== undefined &&
    (upload !== undefined || fields !== undefined)
  ) {
    throw new XMattersError("JSON and form bodies are mutually exclusive");
  }
  let body: string | undefined;
  let contentType: string | undefined;
  if (upload !== undefined) {
    if (
      upload === null ||
      typeof upload !== "object" ||
      typeof upload.name !== "string" ||
      typeof upload.contentBase64 !== "string" ||
      (upload.fieldName !== undefined &&
        typeof upload.fieldName !== "string") ||
      (upload.mimeType !== undefined && typeof upload.mimeType !== "string")
    ) {
      throw new XMattersError("Invalid upload");
    }
    const fieldName = upload.fieldName ?? "file";
    const mimeType = upload.mimeType ?? "application/octet-stream";
    if (
      !upload.name ||
      upload.name === "." ||
      upload.name === ".." ||
      /[/\\"\x00-\x1f\x7f]/.test(upload.name) ||
      Buffer.byteLength(upload.name) > 255 ||
      !/^[a-zA-Z0-9_.-]{1,128}$/.test(fieldName) ||
      mimeType.length > 127 ||
      !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mimeType)
    ) {
      throw new XMattersError("Invalid multipart metadata");
    }
    if (fields !== undefined && Object.hasOwn(fields, fieldName))
      throw new XMattersError("Multipart field collides with the file");
    const encoded = upload.contentBase64;
    // Bound allocation before Node's intentionally lenient base64 decoder is invoked.
    if (encoded.length > Math.ceil(maximum / 3) * 4) throw requestTooLarge();
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new XMattersError("Upload must contain canonical base64");
    }
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded)
      throw new XMattersError("Upload must contain canonical base64");
    // A conservative upper bound includes boundaries and per-part headers, not just file bytes.
    let size =
      bytes.length +
      Buffer.byteLength(upload.name) +
      fieldName.length +
      mimeType.length +
      576;
    for (const [key, value] of Object.entries(fields ?? {})) {
      size += Buffer.byteLength(key) + Buffer.byteLength(value) + 512;
      if (size > maximum) throw requestTooLarge();
      // FormData normalizes lone CR/LF to CRLF. Count added bytes without copying values.
      for (let index = 0; index < value.length; index++) {
        if (value[index] === "\r" && value[index + 1] === "\n") index++;
        else if (value[index] === "\r" || value[index] === "\n") {
          if (++size > maximum) throw requestTooLarge();
        }
      }
    }
    if (size > maximum) throw requestTooLarge();
    const form = new FormData();
    for (const [key, value] of Object.entries(fields ?? {}))
      form.append(key, value);
    form.append(fieldName, new Blob([bytes], { type: mimeType }), upload.name);
    return { body: form }; // Fetch supplies the matching multipart boundary.
  }
  if (fields !== undefined) {
    body = new URLSearchParams(fields).toString();
    contentType = "application/x-www-form-urlencoded";
  } else if (request.body !== undefined) {
    try {
      body = JSON.stringify(request.body);
    } catch {
      throw new XMattersError("Request body is not serializable JSON");
    }
    if (body === undefined)
      throw new XMattersError("Request body is not serializable JSON");
    contentType = "application/json";
  }
  if (body !== undefined && Buffer.byteLength(body) > maximum)
    throw requestTooLarge();
  return { body, contentType };
}

export class XMattersClient {
  readonly #options: ResolvedOptions;
  #authPending = false;
  #accessToken?: string;
  #refreshToken?: string;
  readonly #secretSpellings = new Set<string>();

  constructor(options: ClientOptions) {
    validateAuth(options.auth);
    // Validate the original spelling before URL parsing can normalize unsafe input.
    if (
      typeof options.baseUrl !== "string" ||
      !/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+xmatters\.com(?::443)?\/?$/i.test(
        options.baseUrl,
      ) ||
      /\s/.test(options.baseUrl)
    ) {
      throw new XMattersError("A tenant HTTPS origin on port 443 is required");
    }
    this.#options = {
      ...options,
      baseUrl: new URL(options.baseUrl).origin,
      auth: { ...options.auth },
      timeoutMs: limit(options.timeoutMs, 30_000, 2_147_483_647),
      maxResponseBytes: limit(
        options.maxResponseBytes,
        2 * 1024 * 1024,
        MAX_BUFFER_BYTES,
      ),
      maxUploadBytes: limit(
        options.maxUploadBytes,
        10 * 1024 * 1024,
        MAX_BUFFER_BYTES,
      ),
    };
    for (const [key, value] of Object.entries(this.#options.auth)) {
      if (key !== "type" && typeof value === "string")
        this.#rememberSecret(value);
    }
  }

  async request(request: ApiRequest): Promise<unknown> {
    const snapshot = { ...request };
    const authenticating = snapshot.authAction !== undefined;
    if (authenticating && this.#authPending) {
      throw new XMattersError("An OAuth exchange is already in progress", {
        code: "AUTH_IN_PROGRESS",
      });
    }
    if (authenticating) this.#authPending = true;
    try {
      return await this.#request(snapshot);
    } finally {
      if (authenticating) this.#authPending = false;
    }
  }

  async #request(request: ApiRequest): Promise<unknown> {
    const expiresAt = performance.now() + this.#options.timeoutMs;
    if (
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method) ||
      (request.responseType !== undefined &&
        request.responseType !== "json" &&
        request.responseType !== "binary")
    ) {
      throw new XMattersError("Invalid HTTP method or response type");
    }
    validatePath(request.path);
    const url = new URL(`${this.#options.baseUrl}${request.path}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (
        /^(password|accesstoken|refreshtoken|apikey|apisecret|clientsecret|authorization|token)$/i.test(
          key.replace(/[-_]/g, ""),
        )
      ) {
        throw new XMattersError(
          "Credentials are not permitted in query parameters",
        );
      }
      const values = Array.isArray(value) ? value : [value];
      if (
        values.some(
          (item) =>
            !(
              ["string", "boolean"].includes(typeof item) ||
              (typeof item === "number" && Number.isFinite(item))
            ),
        )
      ) {
        throw new XMattersError("Invalid query value");
      }
      url.searchParams.set(key, values.join(","));
    }
    if (Buffer.byteLength(url.toString()) > MAX_URL_BYTES) {
      throw new XMattersError("Request URL exceeds the byte limit", {
        code: "REQUEST_TOO_LARGE",
      });
    }
    const auth = this.#options.auth;
    let prepared = request;
    if (request.authAction !== undefined) {
      if (
        auth.type !== "oauth" ||
        request.path !== TOKEN_PATH ||
        request.method !== "POST" ||
        request.body !== undefined ||
        request.fields !== undefined ||
        request.upload !== undefined ||
        request.query !== undefined ||
        request.responseType === "binary"
      ) {
        throw new XMattersError(
          "OAuth requires an explicit token action using configured credentials only",
        );
      }
      if (request.authAction === "password") {
        if (!auth.username || !auth.password)
          throw new XMattersError(
            "Configured OAuth username and password are required",
          );
        prepared = {
          ...request,
          fields: {
            grant_type: "password",
            client_id: auth.clientId,
            username: auth.username,
            password: auth.password,
          },
        };
      } else if (request.authAction === "refresh") {
        const refreshToken = this.#refreshToken ?? auth.refreshToken;
        if (!refreshToken)
          throw new XMattersError("An OAuth refresh token is required", {
            code: "AUTH_REQUIRED",
          });
        prepared = {
          ...request,
          fields: {
            grant_type: "refresh_token",
            client_id: auth.clientId,
            refresh_token: refreshToken,
          },
        };
      } else {
        throw new XMattersError("Invalid OAuth action");
      }
    } else if (
      /^\/api\/xm\/[^/]+\/oauth2\/token\/?$/i.test(
        decodeURIComponent(request.path),
      )
    ) {
      throw new XMattersError(
        "The OAuth token endpoint requires an explicit authentication action",
      );
    }
    const { body, contentType } = buildBody(
      prepared,
      this.#options.maxUploadBytes,
    );
    let authorization: string | undefined;
    if (request.authAction !== undefined) {
      authorization = undefined;
    } else if (auth.type === "bearer") {
      authorization = `Bearer ${auth.token}`;
    } else if (auth.type === "api-key" || auth.type === "basic") {
      const username = auth.type === "basic" ? auth.username : auth.apiKey;
      const password = auth.type === "basic" ? auth.password : auth.apiSecret;
      authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    } else {
      if (!this.#accessToken)
        throw new XMattersError("Explicit OAuth authentication is required", {
          code: "AUTH_REQUIRED",
        });
      authorization = `Bearer ${this.#accessToken}`;
    }
    if (authorization !== undefined) this.#rememberSecret(authorization);
    return withDeadline(expiresAt, async (deadline) => {
      const result = await this.#send(
        url,
        request,
        {
          method: request.method,
          body,
          signal: deadline.signal,
          redirect: "manual",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          headers: {
            ...(contentType === undefined
              ? {}
              : { "Content-Type": contentType }),
            Accept:
              request.responseType === "binary" ? "*/*" : "application/json",
            ...(authorization === undefined
              ? {}
              : { Authorization: authorization }),
          },
        },
        deadline,
      );
      deadline.check();
      if (request.authAction !== undefined) return this.#retainTokens(result);
      return request.responseType === "binary"
        ? result
        : this.#redactJson(result);
    });
  }

  #rememberSecret(secret: string): void {
    if (!secret) return;
    this.#secretSpellings.add(secret);
    this.#secretSpellings.add(encodeURIComponent(secret));
    this.#secretSpellings.add(
      new URLSearchParams({ value: secret }).toString().slice("value=".length),
    );
    this.#secretSpellings.add(Buffer.from(secret).toString("base64"));
    if (secret.startsWith("Basic "))
      this.#secretSpellings.add(secret.slice("Basic ".length));
  }

  #redactJson(value: unknown): unknown {
    // Match known credential VALUES, not names like `config` or `token` in tenant data.
    const pattern = new RegExp(
      [...this.#secretSpellings]
        .sort((a, b) => b.length - a.length)
        .map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|"),
      "g",
    );
    const mask = (text: string) => text.replace(pattern, "[REDACTED]");
    const visit = (item: unknown, depth = 0): unknown => {
      if (depth > 64)
        throw new XMattersError("JSON response exceeds the nesting limit", {
          code: "INVALID_RESPONSE",
        });
      if (typeof item === "string") return mask(item);
      if (Array.isArray(item))
        return item.map((child) => visit(child, depth + 1));
      if (item !== null && typeof item === "object") {
        return Object.fromEntries(
          Object.entries(item).map(([key, child]) => [
            mask(key),
            visit(child, depth + 1),
          ]),
        );
      }
      return this.#secretSpellings.has(String(item)) ? "[REDACTED]" : item;
    };
    return visit(value);
  }

  #retainTokens(result: unknown): { authenticated: true; expiresIn?: number } {
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result)
    ) {
      throw new XMattersError("Invalid OAuth token response", {
        code: "INVALID_RESPONSE",
      });
    }
    const data = result as Record<string, unknown>;
    if (
      !validCredential(data.access_token) ||
      !BEARER_TOKEN.test(data.access_token) ||
      (data.token_type !== undefined &&
        (typeof data.token_type !== "string" ||
          data.token_type.toLowerCase() !== "bearer")) ||
      (data.refresh_token !== undefined &&
        !validCredential(data.refresh_token)) ||
      (data.expires_in !== undefined &&
        (typeof data.expires_in !== "number" ||
          !Number.isSafeInteger(data.expires_in) ||
          data.expires_in < 0))
    ) {
      throw new XMattersError("Invalid OAuth token response", {
        code: "INVALID_RESPONSE",
      });
    }
    this.#accessToken = data.access_token;
    this.#rememberSecret(data.access_token);
    if (typeof data.refresh_token === "string") {
      this.#refreshToken = data.refresh_token;
      this.#rememberSecret(data.refresh_token);
    }
    return {
      authenticated: true,
      ...(data.expires_in === undefined
        ? {}
        : { expiresIn: data.expires_in as number }),
    };
  }

  async #send(
    url: URL,
    request: ApiRequest,
    init: RequestInit,
    deadline: Deadline,
  ): Promise<unknown> {
    const { signal } = deadline;
    let response: Response;
    try {
      response = await (this.#options.fetch ?? globalThis.fetch)(
        url.toString(),
        init,
      );
    } catch {
      if (signal.aborted) throw timeoutError();
      throw new XMattersError(
        "xMatters transport failed; the request was not retried",
        { code: "NETWORK_ERROR" },
      );
    }
    try {
      deadline.check();
    } catch (error) {
      void response.body?.cancel().catch(() => {});
      throw error;
    }
    let changedOrigin = false;
    try {
      changedOrigin =
        response.url !== "" &&
        new URL(response.url).origin !== this.#options.baseUrl;
    } catch {
      changedOrigin = true;
    }
    const redirected =
      response.redirected ||
      (response.status >= 300 && response.status < 400) ||
      changedOrigin;
    if (redirected || !response.ok) {
      // Do not parse or reflect error bodies: these can echo credentials and tokens.
      void response.body?.cancel().catch(() => {});
      const value = response.headers.get("Retry-After");
      const retryAfter =
        (response.status === 429 || response.status === 503) &&
        value !== null &&
        /^\d+$/.test(value) &&
        Number.isSafeInteger(Number(value))
          ? Number(value)
          : undefined;
      throw new XMattersError(
        `xMatters request failed (HTTP ${response.status}); the request was not retried`,
        {
          status: response.status,
          code: redirected ? "REDIRECT_REJECTED" : "HTTP_ERROR",
          retryAfter,
        },
      );
    }
    if (response.status === 204 || response.status === 205) return null;
    const bytes = await readResponse(
      response,
      this.#options.maxResponseBytes,
      deadline,
    );
    const mimeType = response.headers
      .get("Content-Type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (request.responseType === "binary") {
      for (const secret of this.#secretSpellings) {
        if (bytes.includes(Buffer.from(secret)) || mimeType?.includes(secret)) {
          throw new XMattersError(
            "Credential-bearing binary response was suppressed",
            { code: "SENSITIVE_RESPONSE", status: response.status },
          );
        }
      }
      return {
        contentBase64: bytes.toString("base64"),
        mimeType: mimeType || "application/octet-stream",
      };
    }
    try {
      if (mimeType !== "application/json" && !mimeType?.endsWith("+json"))
        throw new Error();
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown;
    } catch {
      throw new XMattersError("xMatters returned an invalid JSON response", {
        code: "INVALID_RESPONSE",
        status: response.status,
      });
    }
  }
}
