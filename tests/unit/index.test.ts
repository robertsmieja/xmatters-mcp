import { expect, it } from "vitest";
import * as api from "../../src/index.js";
import { XMattersClient } from "../../src/client.js";
it("exports the typed public library entrypoint", () => {
  expect(api.XMattersClient).toBe(XMattersClient);
  expect(api.createServer).toBeTypeOf("function");
  expect(api.loadConfig).toBeTypeOf("function");
  expect(api.operations).toHaveLength(179);
});
