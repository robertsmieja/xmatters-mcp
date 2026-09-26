import { describe, expect, it, vi } from "vitest";
import { XMattersClient, type ApiRequest } from "../../src/client.js";

const baseUrl = "https://example.xmatters.com";
const lineEndings = [
  ["LF", "\n"],
  ["CR", "\r"],
  ["CRLF", "\r\n"],
] as const;

function setup(maxUploadBytes: number) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ ok: true }));
  const client = new XMattersClient({
    baseUrl,
    auth: { type: "bearer", token: "multipart-size-fixture" },
    maxUploadBytes,
    fetch,
  });
  return { client, fetch };
}

describe("multipart serialized line-ending byte limits", () => {
  it.each(lineEndings)(
    "rejects an oversized %s field before transport even with an empty file",
    async (_label, lineEnding) => {
      const { client, fetch } = setup(5000);
      await expect(
        client.request({
          method: "POST",
          path: "/api/xm/1/uploads",
          upload: { name: "f.csv", contentBase64: "" },
          fields: { name: lineEnding.repeat(3000) },
        }),
      ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(lineEndings)(
    "counts %s at the conservative budget boundary without changing file bytes or the native multipart boundary",
    async (_label, lineEnding) => {
      const bytes = Buffer.from("file\r\npayload\nraw\rend\0é");
      const value = `é${lineEnding.repeat(1000)}`;
      const normalized = `é${"\r\n".repeat(1000)}`;
      const request: ApiRequest = {
        method: "POST",
        path: "/api/xm/1/uploads",
        upload: { name: "f.csv", contentBase64: bytes.toString("base64") },
        fields: { name: value },
      };
      // Preserve the existing conservative header/boundary allowance; only text
      // value bytes must reflect FormData's CRLF serialization.
      const budget =
        bytes.length +
        Buffer.byteLength("f.csvfileapplication/octet-streamname") +
        576 +
        512 +
        Buffer.byteLength(normalized);
      const below = setup(budget - 1);
      await expect(below.client.request(request)).rejects.toMatchObject({
        code: "REQUEST_TOO_LARGE",
      });
      expect(below.fetch).not.toHaveBeenCalled();

      const at = setup(budget);
      await expect(at.client.request(request)).resolves.toEqual({ ok: true });
      expect(at.fetch).toHaveBeenCalledOnce();
      const [url, init] = at.fetch.mock.calls[0]!;
      expect(init?.body).toBeInstanceOf(FormData);
      expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
      expect((init?.body as FormData).get("name")).toBe(value);
      const encoded = new Request(url, init);
      expect(encoded.headers.get("Content-Type")).toMatch(
        /^multipart\/form-data; boundary=.+/,
      );
      const serialized = await encoded.arrayBuffer();
      expect(serialized.byteLength).toBeLessThanOrEqual(budget);
      const decoded = await new Response(serialized, {
        headers: encoded.headers,
      }).formData();
      expect(decoded.get("name")).toBe(normalized);
      const file = decoded.get("file") as File;
      expect(file.name).toBe("f.csv");
      expect(file.type).toBe("application/octet-stream");
      expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
    },
  );
});
