#!/usr/bin/env node
/** Audits public xMatters reference metadata; never sends tenant requests. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function auditCatalog(operations, inventory) {
  const errors = [];
  const byId = new Map();
  for (const operation of operations) {
    if (byId.has(operation.id))
      errors.push(`Duplicate tool ID: ${operation.id}`);
    byId.set(operation.id, operation);
    if (!/^xmatters_[a-z0-9_]{1,55}$/.test(operation.id))
      errors.push(`Invalid tool ID: ${operation.id}`);
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(operation.method))
      errors.push(`Invalid method: ${operation.id}`);
    if (
      !/^\/api\/(xm|integration)\/1\/[^?#\s]+$/.test(operation.path) ||
      operation.path.includes("..")
    )
      errors.push(`Invalid full path: ${operation.id}`);
    if (
      !["none", "json", "multipart", "form"].includes(operation.request) ||
      !["json", "binary"].includes(operation.response)
    )
      errors.push(`Invalid encoding: ${operation.id}`);
    const names = [...operation.path.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    );
    if (!same(names, operation.pathParams))
      errors.push(`pathParams differ from template: ${operation.id}`);
    for (const field of [
      "pathParams",
      "queryParams",
      "bodyParams",
      "requiredQueryParams",
      "requiredBodyParams",
    ]) {
      const values = operation[field];
      if (
        !Array.isArray(values) ||
        values.some((value) => typeof value !== "string") ||
        new Set(values).size !== values.length
      )
        errors.push(`Invalid ${field}: ${operation.id}`);
    }
    for (const [required, available] of [
      ["requiredQueryParams", "queryParams"],
      ["requiredBodyParams", "bodyParams"],
    ]) {
      if (
        operation[required].some((name) => !operation[available].includes(name))
      )
        errors.push(`Unknown ${required} field: ${operation.id}`);
    }
    if (
      operation.authAction &&
      (!["password", "refresh"].includes(operation.authAction) ||
        operation.request !== "form" ||
        operation.path !== "/api/xm/1/oauth2/token" ||
        operation.queryParams.length ||
        operation.bodyParams.length)
    )
      errors.push(
        `OAuth credentials must come only from configuration: ${operation.id}`,
      );
  }
  const counts = {
    sourceHeadings: inventory.headings.length,
    sourceOperationHeadings: inventory.definitions.length,
    definitionBlocks: inventory.definitions.length,
    definitionRequestExamples: inventory.definitions.reduce(
      (n, d) => n + d.requests.length,
      0,
    ),
    definitionOperationPathVariants: inventory.definitions.reduce(
      (n, d) =>
        n + new Set(d.resolutions.map((r) => `${r.method} ${r.path}`)).size,
      0,
    ),
    supplementalOperationPathVariants: inventory.operations.filter(
      (entry) => entry.sourceKind !== "definition",
    ).length,
    namedTools: operations.length,
    uniqueMethodPaths: new Set(operations.map((o) => `${o.method} ${o.path}`))
      .size,
    uniqueRouteShapes: new Set(
      operations.map(
        (o) => `${o.method} ${o.path.replace(/\{[^}]+\}/g, "{}")}`,
      ),
    ).size,
    coveredDefinitionBlocks: inventory.definitions.filter(
      (d) => d.requests.length && d.requests.length === d.resolutions.length,
    ).length,
    uncoveredDefinitionBlocks: inventory.definitions.filter(
      (d) => !d.requests.length || d.requests.length !== d.resolutions.length,
    ).length,
  };
  for (const [field, key] of [
    ["group", "groups"],
    ["method", "methods"],
    ["request", "requestEncodings"],
    ["response", "responseEncodings"],
  ]) {
    counts[key] = {};
    for (const operation of operations)
      counts[key][operation[field]] = (counts[key][operation[field]] ?? 0) + 1;
  }
  for (const [key, value] of Object.entries(counts)) {
    if (!same(value, inventory.counts[key]))
      errors.push(`Inventory count differs: ${key}`);
  }
  if (digest(JSON.stringify(operations)) !== inventory.catalogSha256)
    errors.push("Catalog SHA-256 differs from the reviewed inventory");
  if (operations.length !== inventory.counts.namedTools)
    errors.push("Named-tool count differs from inventory");
  if (inventory.operations.length !== operations.length)
    errors.push("Manifest length differs from catalog");
  const mappedIds = new Set();
  for (const entry of inventory.operations) {
    const operation = byId.get(entry.toolId);
    if (mappedIds.has(entry.toolId))
      errors.push(`Duplicate manifest entry: ${entry.toolId}`);
    mappedIds.add(entry.toolId);
    if (!operation) {
      errors.push(`Manifest tool missing: ${entry.toolId}`);
      continue;
    }
    for (const field of ["method", "path", "request", "response", "docsUrl"]) {
      if (entry[field] !== operation[field])
        errors.push(`Manifest ${field} differs: ${entry.toolId}`);
    }
  }
  for (const operation of operations) {
    if (!mappedIds.has(operation.id))
      errors.push(`Tool missing from manifest: ${operation.id}`);
  }
  for (const definition of inventory.definitions) {
    if (definition.requests.length !== definition.resolutions.length)
      errors.push(`Definition resolution count differs: ${definition.anchor}`);
    for (const [index, resolution] of definition.resolutions.entries()) {
      const operation = byId.get(resolution.toolId);
      const request = definition.requests[index];
      if (resolution.raw !== request?.raw)
        errors.push(`Definition resolution text differs: ${definition.anchor}`);
      if (
        !operation ||
        resolution.method !== operation.method ||
        resolution.path !== operation.path
      )
        errors.push(
          `Definition resolution target differs: ${definition.anchor}`,
        );
      if (request) {
        const rawFullPath = request.path.startsWith("/api/")
          ? request.path
          : `${inventory.reference.basePath}/${request.path.replace(/^\//, "")}`;
        const correction = inventory.corrections.find(
          (c) => c.id === resolution.correctionId,
        );
        if (resolution.correctionId || resolution.path !== rawFullPath) {
          const documented = correction?.rewrites?.some(
            (rewrite) =>
              rewrite.sourceAnchor === definition.anchor &&
              rewrite.rawPath === request.path &&
              rewrite.path === resolution.path,
          );
          if (!documented)
            errors.push(`Unaudited definition rewrite: ${definition.anchor}`);
        }
        if (resolution.method !== request.method)
          errors.push(`Definition method changed: ${definition.anchor}`);
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    namedTools: operations.length,
    definitionBlocks: inventory.definitions.length,
  };
}

export function auditReference(source, inventory) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8");
  const parsed = parseReference(bytes.toString("utf8"));
  const errors = [];
  if (digest(bytes) !== inventory.reference.sha256)
    errors.push(
      "Reference hash changed; re-audit the current public documentation before updating the snapshot",
    );
  if (bytes.length !== inventory.reference.bytes)
    errors.push("Reference byte count changed");
  if (!same(parsed.headings, inventory.headings))
    errors.push("Source heading inventory changed");
  const recorded = inventory.definitions.map(
    ({ resolutions: _resolutions, ...definition }) => definition,
  );
  if (!same(parsed.definitions, recorded))
    errors.push("Source DEFINITION inventory changed");
  if (!parsed.definitions.length)
    errors.push("No definitions found; not a valid public reference");
  const sections = new Map(
    parsed.sections.map((section) => [section.anchor, section.text]),
  );
  const checkEvidence = (anchor, quote, label) => {
    if (!quote || !sections.get(anchor)?.includes(quote))
      errors.push(`Source evidence not found: ${label} (${anchor})`);
  };
  for (const correction of inventory.corrections) {
    if (!correction.evidence.length)
      errors.push(`Correction lacks evidence: ${correction.id}`);
    for (const evidence of correction.evidence)
      checkEvidence(evidence.sourceAnchor, evidence.quote, correction.id);
  }
  for (const operation of inventory.operations) {
    if (operation.sourceKind !== "definition") {
      if (!operation.evidence?.length)
        errors.push(
          `Supplemental operation lacks evidence: ${operation.toolId}`,
        );
      for (const quote of operation.evidence ?? [])
        checkEvidence(operation.sourceAnchor, quote, operation.toolId);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    sha256: digest(bytes),
    sourceHeadings: parsed.headings.length,
    definitionBlocks: parsed.definitions.length,
  };
}

function text(html) {
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return html
    .replace(/<\/(?:p|li|tr|pre|div)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) =>
      String.fromCodePoint(
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n),
      ),
    )
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/gi,
      (_, n) => entities[n.toLowerCase()],
    )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function parseReference(html) {
  const matches = [...html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)];
  const headings = [];
  const definitions = [];
  let group = "",
    anchor = "",
    title = "";
  for (const [index, match] of matches.entries()) {
    const level = Number(match[1]);
    const headingAnchor = /\bid=['"]([^'"]+)['"]/.exec(match[2])?.[1] ?? "";
    const headingTitle = text(match[3]);
    if (level === 1) group = headingTitle;
    if (level === 2) {
      anchor = headingAnchor;
      title = headingTitle;
    }
    headings.push({ level, anchor: headingAnchor, title: headingTitle, group });
    if (headingTitle.toUpperCase() === "DEFINITION") {
      const definitionText = text(
        html.slice(
          match.index + match[0].length,
          matches[index + 1]?.index ?? html.length,
        ),
      );
      const requests = [
        ...definitionText.matchAll(
          /^(GET|POST|PUT|PATCH|DELETE) +([^\s?]+)([^\n]*)/gm,
        ),
      ].map((item) => ({
        method: item[1],
        path: item[2],
        raw: item[0],
      }));
      definitions.push({
        headingIndex: index,
        group,
        anchor,
        title,
        text: definitionText,
        requests,
      });
    }
  }
  const major = matches
    .map((match, i) => ({ match, heading: headings[i] }))
    .filter((item) => item.heading.level <= 2);
  const sections = major.map(({ match, heading }, i) => {
    const block = html.slice(
      match.index + match[0].length,
      major[i + 1]?.match.index ?? html.length,
    );
    const tables = [
      ...block.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi),
    ].map((table) => {
      const priorHeadings = [
        ...block
          .slice(0, table.index)
          .matchAll(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi),
      ];
      const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
        (row) =>
          [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
            (cell) => text(cell[1]),
          ),
      );
      return {
        heading: text(priorHeadings.at(-1)?.[1] ?? ""),
        headers: rows[0] ?? [],
        rows: rows.slice(1),
      };
    });
    return { ...heading, text: text(block), tables };
  });
  return { headings, definitions, sections };
}

export async function fetchReference(fetchImpl = fetch) {
  const maxBytes = 8 * 1024 * 1024;
  const response = await fetchImpl("https://help.xmatters.com/xmapi/", {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: "text/html" },
  });
  if (!response.ok) throw new Error(`Public reference HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.includes("text/html"))
    throw new Error("Public reference is not HTML");
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new Error("Public reference exceeds 8 MiB limit");
  if (!response.body) throw new Error("Public reference has no response body");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes)
      throw new Error("Public reference exceeds 8 MiB limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function runCli(args, fetchImpl = fetch) {
  const mode = args[0] ?? "--offline";
  if (mode === "--help" && args.length === 1) {
    console.log(
      "Usage: node scripts/audit-api.mjs [--offline | --source FILE | --live]\nOffline mode checks the committed inventory only. Source mode audits downloaded HTML. Live mode fetches only https://help.xmatters.com/xmapi/ and checks hash, headings, definitions and evidence; no tenant credentials or requests.",
    );
    return 0;
  }
  if (!(
    (mode === "--offline" && args.length <= 1) ||
    (mode === "--source" && args.length === 2) ||
    (mode === "--live" && args.length === 1)
  ))
    throw new Error("Invalid arguments; use --help");
  const [operations, inventory] = await Promise.all(
    ["../src/operations.json", "../docs/api-inventory.json"].map(async (file) =>
      JSON.parse(await readFile(new URL(file, import.meta.url), "utf8")),
    ),
  );
  const catalog = auditCatalog(operations, inventory);
  const source =
    mode === "--source"
      ? await readFile(args[1])
      : mode === "--live"
        ? await fetchReference(fetchImpl)
        : undefined;
  const reference = source ? auditReference(source, inventory) : undefined;
  const errors = [...catalog.errors, ...(reference?.errors ?? [])];
  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0,
        mode,
        namedTools: operations.length,
        definitionBlocks: inventory.definitions.length,
        sourceHeadings: inventory.headings.length,
        ...(reference ? { sourceSha256: reference.sha256 } : {}),
        errors,
      },
      null,
      2,
    ),
  );
  return errors.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`API audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
