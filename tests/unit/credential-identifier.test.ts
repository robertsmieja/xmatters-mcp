import { expect, it } from "vitest";
import { XMattersClient } from "../../src/client.js";
it("rejects a raw API-key identifier rather than silently repairing it", () => {
  expect(
    () =>
      new XMattersClient({
        baseUrl: "https://example.xmatters.com",
        auth: {
          type: "api-key",
          apiKey: "raw-identifier",
          apiSecret: "test-only",
        },
      }),
  ).toThrow(/authentication configuration/);
});
