// Test-only preload. Never part of the published package, never calls a tenant.
globalThis.fetch = async (input, init) => {
  if (
    String(input) !== "https://example.xmatters.com/api/xm/1/people?limit=1" ||
    init?.method !== "GET" ||
    init?.redirect !== "manual"
  ) {
    throw new Error("Unexpected request in HTTP fixture");
  }
  const authorization = new Headers(init.headers).get("Authorization");
  if (
    authorization !==
    `Basic ${Buffer.from("x-api-key-http-fixture:http-fixture-secret").toString("base64")}`
  ) {
    throw new Error("Missing fixture authentication");
  }
  return Response.json({
    data: [{ id: "synthetic-person" }],
    count: 1,
    total: 1,
  });
};
