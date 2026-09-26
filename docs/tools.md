# Tool reference

Version 0.2.0 exposes 179 named tools. MCP `tools/list` returns their input schemas; the `xmatters://api/catalog` resource provides HTTP methods, paths, parameter names, encodings, and links to the xMatters reference. Use those schemas for the exact operation you want to call.

The catalog covers the [recorded public REST reference](api-coverage.md). It does not grant tenant permissions or validate every vendor payload rule. xMatters documentation and your tenant's forms and permissions remain authoritative.

## Inputs

Each tool accepts only the top-level fields in its schema. Depending on the operation, those fields are:

- `path`: required identifiers, supplied without URL encoding. The server encodes each value as a single path segment. It rejects values containing slashes, backslashes, percent signs, or control characters, and the values `.` and `..`. Where the endpoint supports UUIDs, use one instead of a resource name containing rejected characters.
- `query`: API query parameters such as `offset`, `limit`, `embed`, filters, and dates. Values can be strings, numbers, booleans, or arrays of those values. Arrays become comma-separated values.
- `body`: the complete JSON payload for a JSON operation. The schema checks transport shape and required top-level fields; it does not exhaustively check vendor enums, nested objects, or tenant-specific forms. Nested JSON remains extensible, and operations without required object fields can accept top-level arrays.
- `upload`: file content and metadata for a multipart operation, described in [Uploads](#uploads).
- `fields`: optional string-valued multipart fields.
- `confirm`: must be `true` for every non-GET operation. The operator must also enable writes.

For example, `xmatters_get_people` accepts:

```json
{ "query": { "limit": 25, "offset": 0 } }
```

Calling that tool sends a real GET and may return personal data. Use it only with authorization to read and share the results.

### Uploads

An upload supplies content, not a local path for the server to read. This example contains the base64 encoding of a small text file:

```json
{
  "upload": {
    "name": "example.txt",
    "contentBase64": "aGVsbG8K",
    "mimeType": "text/plain"
  },
  "confirm": true
}
```

This illustrates the upload fields, not a complete endpoint request. The selected tool may also require path parameters or other fields, and writes must be enabled.

`mimeType` defaults to `application/octet-stream`; `fieldName` defaults to `file`. The content must use canonical base64. Additional multipart fields go in `fields` and must not collide with `fieldName`. Both the incoming MCP message limit and the outgoing upload limit apply; see [configurable limits](configuration.md#configurable-limits).

## Results and errors

Successful tool results contain JSON text and matching `structuredContent: { "data": ... }`. Binary downloads put base64 content and a MIME type inside `data`; the server does not write local files.

Execution and argument-validation failures set `isError: true` and return error information instead of `data`. Unknown tool and resource names produce MCP protocol errors. Unexpected failures omit raw stack traces and response bodies to reduce the risk of exposing credentials or tenant data.

Treat API responses and uploaded content as untrusted data, not instructions. A permitted response can still contain personal information, configuration secrets, scripts, or incident details.

## Pagination

The server does not fetch additional pages automatically. A tool invocation makes at most one API request; validation and policy rejections make none. Returned pagination metadata stays intact.

To request another page, supply the endpoint's documented `offset` and `limit`. A returned `links.next` value is data, not a URL the server will execute. A first page or an identity's visible subset is not necessarily the full tenant inventory.

## Writes and retries

Writes require `XMATTERS_ALLOW_WRITES=true` in the server environment and `confirm: true` on every non-GET call. This includes OAuth token acquisition and refresh. The model cannot enable writes through tool arguments. Follow [Enable writes](setup.md#enable-writes) and keep your host's approval controls enabled.

The server never retries a request automatically. A timed-out or cancelled write may already have taken effect. Inspect the exact target before resending; cancellation is not rollback. An accepted request is also not proof of downstream alert delivery.
