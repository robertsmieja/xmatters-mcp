import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

function readJson(relative) {
  try {
    return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

test("catalog includes separate named operations, path aliases, secure OAuth and binary/multipart encodings", () => {
  const operations = readJson("../src/operations.json");
  assert.ok(Array.isArray(operations), "audited catalog must exist");
  const byId = new Map(
    operations.map((operation) => [operation.id, operation]),
  );
  assert.equal(
    byId.get("xmatters_delete_a_device_name")?.path,
    "/api/xm/1/device-names/{deviceID}",
  );
  assert.equal(
    byId.get("xmatters_delete_a_plan_endpoint")?.path,
    "/api/xm/1/plans/{planId}/endpoints/{endpointId}",
  );
  assert.equal(
    byId.get("xmatters_create_a_device")?.path,
    byId.get("xmatters_modify_a_device")?.path,
  );
  assert.equal(
    byId.get("xmatters_trigger_an_incident_form")?.path,
    "/api/xm/1/forms/{formId}/triggers",
  );
  assert.equal(
    byId.get("xmatters_update_a_shift_by_id")?.path,
    "/api/xm/1/groups/{groupID}/shifts/{shiftID}",
  );
  assert.equal(
    byId.get("xmatters_get_an_event_attachment")?.response,
    "binary",
  );
  assert.equal(
    byId.get("xmatters_upload_attachment_to_a_scenario")?.request,
    "multipart",
  );
  assert.equal(
    byId.get("xmatters_obtain_an_access_token_and_refresh_token")?.authAction,
    "password",
  );
  assert.equal(
    byId.get("xmatters_refresh_an_access_token")?.authAction,
    "refresh",
  );
  assert.ok(
    operations
      .filter((operation) => operation.authAction)
      .every(
        (operation) =>
          operation.request === "form" &&
          operation.queryParams.length === 0 &&
          operation.bodyParams.length === 0,
      ),
  );
});

const audit = await import("../scripts/audit-api.mjs").catch(() => ({}));

test("audits one-to-one catalog/manifest coverage and rejects missing, duplicated or changed descriptors", () => {
  assert.equal(
    typeof audit.auditCatalog,
    "function",
    "catalog auditor must exist",
  );
  const operations = readJson("../src/operations.json");
  const inventory = readJson("../docs/api-inventory.json");
  assert.deepEqual(audit.auditCatalog(operations, inventory).errors, []);
  assert.ok(
    audit.auditCatalog(operations.slice(1), inventory).errors.length > 0,
  );
  assert.ok(
    audit
      .auditCatalog([...operations, operations[0]], inventory)
      .errors.some((error) => /duplicate/i.test(error)),
  );
  const changed = structuredClone(operations);
  changed[0].method = "GET";
  assert.ok(
    audit
      .auditCatalog(changed, inventory)
      .errors.some((error) => /manifest/i.test(error)),
  );
  const brokenInventory = structuredClone(inventory);
  brokenInventory.definitions[0].resolutions = [];
  assert.ok(
    audit
      .auditCatalog(operations, brokenInventory)
      .errors.some((error) => /resolution/i.test(error)),
  );
});

test("rejects malformed contracts, credential arguments, count drift and unaudited definition rewrites", () => {
  const operations = readJson("../src/operations.json");
  const inventory = readJson("../docs/api-inventory.json");
  const changed = structuredClone(operations);
  changed[0].pathParams = ["notInPath"];
  changed.find((operation) => operation.authAction).queryParams = ["password"];
  let errors = audit.auditCatalog(changed, inventory).errors;
  assert.ok(errors.some((error) => /pathParams/.test(error)));
  assert.ok(errors.some((error) => /credentials/i.test(error)));
  const changedInventory = structuredClone(inventory);
  changedInventory.counts.methods.GET = -1;
  changedInventory.definitions.find(
    (definition) => definition.anchor === "delete-a-device-name",
  ).resolutions[0].correctionId = "UNKNOWN";
  errors = audit.auditCatalog(operations, changedInventory).errors;
  assert.ok(errors.some((error) => /count.*methods/i.test(error)));
  assert.ok(errors.some((error) => /unaudited.*rewrite/i.test(error)));
});

test("verifies raw-source hash, every heading/definition and the evidence for manual additions", () => {
  assert.equal(
    typeof audit.auditReference,
    "function",
    "source auditor must exist",
  );
  const html = `<h1 id='events'>EVENTS</h1><h2 id='list-events'>List events</h2>
<h3>DEFINITION</h3><p>GET /events</p><p>Additional example evidence.</p>`;
  const parsed = audit.parseReference(html);
  const inventory = {
    reference: {
      sha256: createHash("sha256").update(html).digest("hex"),
      bytes: Buffer.byteLength(html),
    },
    headings: parsed.headings,
    definitions: parsed.definitions,
    corrections: [
      {
        id: "C01",
        evidence: [{ sourceAnchor: "list-events", quote: "GET /events" }],
      },
    ],
    operations: [
      {
        toolId: "xmatters_list_events",
        sourceAnchor: "list-events",
        sourceKind: "request-example",
        evidence: ["Additional example evidence."],
      },
    ],
  };
  assert.deepEqual(
    audit.auditReference(Buffer.from(html), inventory).errors,
    [],
  );
  let errors = audit.auditReference(
    html.replace("GET /events", "GET /new"),
    inventory,
  ).errors;
  assert.ok(errors.some((error) => /hash/i.test(error)));
  assert.ok(errors.some((error) => /definition/i.test(error)));
  assert.ok(errors.some((error) => /evidence/i.test(error)));
  errors = audit.auditReference(
    html + '<h2 id="new">New endpoint</h2><h3>DEFINITION</h3><p>POST /new</p>',
    inventory,
  ).errors;
  assert.ok(errors.some((error) => /heading/i.test(error)));
  const changed = structuredClone(inventory);
  changed.operations[0].evidence = [];
  assert.ok(
    audit
      .auditReference(html, changed)
      .errors.some((error) => /evidence/i.test(error)),
  );
});

test("fetches only official public documentation and bounds/validates the response", async () => {
  assert.equal(
    typeof audit.fetchReference,
    "function",
    "bounded public-doc fetcher must exist",
  );
  const html = '<h1 id="rest">Public reference</h1>';
  const result = await audit.fetchReference(async (url, options) => {
    assert.equal(url, "https://help.xmatters.com/xmapi/");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    return new Response(html, { headers: { "content-type": "text/html" } });
  });
  assert.equal(result.toString(), html);
  await assert.rejects(
    audit.fetchReference(async () => new Response("denied", { status: 403 })),
    /403/,
  );
  await assert.rejects(
    audit.fetchReference(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    ),
    /HTML/i,
  );
  await assert.rejects(
    audit.fetchReference(
      async () =>
        new Response("", {
          headers: {
            "content-type": "text/html",
            "content-length": "999999999",
          },
        }),
    ),
    /limit/i,
  );
  await assert.rejects(
    audit.fetchReference(
      async () =>
        new Response("x".repeat(8 * 1024 * 1024 + 1), {
          headers: { "content-type": "text/html" },
        }),
    ),
    /limit/i,
  );
  await assert.rejects(
    audit.fetchReference(
      async () =>
        new Response(null, { headers: { "content-type": "text/html" } }),
    ),
    /body/i,
  );
});

test("CLI live mode audits fetched public HTML rather than accepting a successful HTTP response", async (t) => {
  t.mock.method(console, "log", () => {});
  let fetched = false;
  const code = await audit.runCli(["--live"], async () => {
    fetched = true;
    return new Response("<h1>Changed or blocked page</h1>", {
      headers: { "content-type": "text/html" },
    });
  });
  assert.equal(fetched, true);
  assert.equal(code, 1);
});

test("CLI performs offline checks and fails closed for invalid arguments or changed source", () => {
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [new URL("../scripts/audit-api.mjs", import.meta.url).pathname, ...args],
      { encoding: "utf8" },
    );
  let result = run("--offline");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"namedTools": 179/);
  result = run("--help");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--source/);
  assert.equal(run("--unknown").status, 1);
  assert.equal(run("--source").status, 1);
  assert.equal(run("--source", new URL(import.meta.url).pathname).status, 1);
});

test("extracts operation text, request encodings, examples and parameter tables outside definitions", () => {
  const parsed =
    audit.parseReference(`<h1 id="upload">UPLOAD</h1><h2 id='upload-file'>Upload file</h2>
<pre><code>curl -X POST https://example.xmatters.com/api/xm/1/files</code></pre>
<p>Use multipart/form-data &amp; &#x66;iles.</p><h3 id='body'>BODY PARAMETERS</h3>
<table><tr><th>Name</th><th>Required</th><th>Type</th><th>Description</th></tr>
<tr><td>file</td><td>Yes</td><td>binary</td><td>A file.</td></tr></table>
<h2 id='next'>Next</h2><p>Not this section.</p>`);
  assert.ok(
    Array.isArray(parsed.sections),
    "section-level evidence must be extracted",
  );
  assert.equal(parsed.sections[1].anchor, "upload-file");
  assert.ok(
    parsed.sections[1].text.includes("Use multipart/form-data & files."),
  );
  assert.ok(!parsed.sections[1].text.includes("Not this section."));
  assert.deepEqual(parsed.sections[1].tables, [
    {
      heading: "BODY PARAMETERS",
      headers: ["Name", "Required", "Type", "Description"],
      rows: [["file", "Yes", "binary", "A file."]],
    },
  ]);
});

test("ignores prose mentioning POST requests while retaining relative definition paths", () => {
  const parsed =
    audit.parseReference(`<h1 id='events'>EVENTS</h1><h2 id='trigger'>Trigger</h2>
<h3>DEFINITION</h3><p>Trigger by sending a POST request to the URL.</p>
<p>POST /api/integration/1/functions/{id}/triggers</p><p>POST groups/{groupID}/shifts/</p>`);
  assert.deepEqual(
    parsed.definitions[0].requests.map((r) => r.path),
    ["/api/integration/1/functions/{id}/triggers", "groups/{groupID}/shifts/"],
  );
});

test("extracts every DEFINITION with its source heading and preserves method/path spelling", () => {
  assert.equal(
    typeof audit.parseReference,
    "function",
    "public-reference parser must exist",
  );
  const result = audit.parseReference(`<h1 id='devices'>DEVICES</h1>
<h2 id='get-a-device'>Get a device</h2><h3 id='definition'>DEFINITION</h3>
<p>GET /devices/{deviceID}</p><p>GET /devices/{deviceID}?embed=owner&amp;limit=5</p>
<h3 id='url-parameters'>URL PARAMETERS</h3><table><tr><th>Parameter</th><th>Description</th></tr><tr><td>deviceID</td><td>Identifier.</td></tr></table>`);
  assert.equal(result.headings.length, 4);
  assert.deepEqual(result.definitions[0], {
    headingIndex: 2,
    group: "DEVICES",
    anchor: "get-a-device",
    title: "Get a device",
    text: "GET /devices/{deviceID}\nGET /devices/{deviceID}?embed=owner&limit=5",
    requests: [
      {
        method: "GET",
        path: "/devices/{deviceID}",
        raw: "GET /devices/{deviceID}",
      },
      {
        method: "GET",
        path: "/devices/{deviceID}",
        raw: "GET /devices/{deviceID}?embed=owner&limit=5",
      },
    ],
  });
});
