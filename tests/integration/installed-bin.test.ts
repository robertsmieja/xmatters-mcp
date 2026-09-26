import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { operations } from "../../src/index.js";
import {
  makeClient,
  missingConfig,
  requestOptions,
  root,
  runtime,
  startCli,
  type RunningCli,
} from "../helpers/http-process.js";

let directory: string;
let installedBin: string;
let preservedSharedBuild: boolean;
let server: RunningCli | undefined;

beforeAll(() => {
  directory = mkdtempSync(
    join(tmpdir(), `xmatters-mcp-${runtime}-installed-bin-`),
  );
  // Package managers may access registries, but never receive the host's API
  // credentials, npm auth configuration, preload hooks or lifecycle opt-ins.
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: directory,
    TMPDIR: tmpdir(),
  };
  const options = {
    encoding: "utf8" as const,
    timeout: 60000,
    killSignal: "SIGKILL" as const,
    env,
  };
  try {
    const sharedOutput = join(root, "dist", "client.js");
    const before = statSync(sharedOutput, { bigint: true }).mtimeNs;
    // Integration suites require a prior build. Do not let prepack rewrite
    // shared dist files while other workers launch them; CI separately tests
    // the real prepack hook with npm pack --dry-run after the suite finishes.
    const packed = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
        { ...options, cwd: root },
      ),
    ) as { filename: string }[];
    preservedSharedBuild =
      statSync(sharedOutput, { bigint: true }).mtimeNs === before;
    expect(packed).toHaveLength(1);
    const tarball = join(directory, packed[0]!.filename);
    if (runtime === "bun") {
      execFileSync(
        "bun",
        ["--no-env-file", "add", "--ignore-scripts", tarball],
        {
          ...options,
          cwd: directory,
        },
      );
    } else {
      execFileSync(
        "npm",
        [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
          "--prefer-offline",
          tarball,
        ],
        { ...options, cwd: directory },
      );
    }
    installedBin = join(directory, "node_modules", ".bin", "xmatters-mcp");
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}, 120000);

afterEach(async () => {
  const running = server;
  server = undefined;
  if (running) {
    expect(await running.stop()).toEqual({ code: 0, signal: null });
    expect(running.stdout()).toBe("");
    expect(running.stderr()).toBe(
      `xmatters-mcp: listening on ${running.url}\n`,
    );
  }
}, 15000);

afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe(`${runtime === "bun" ? "bun" : "npm"}-installed HTTP bin symlink on ${runtime}`, () => {
  it("packs without rewriting the shared build used by parallel HTTP tests", () => {
    expect(preservedSharedBuild).toBe(true);
  });

  it("discovers the packaged modern server, lists all 179 tools and executes a synthetic GET through the installed executable", async () => {
    expect(lstatSync(installedBin).isSymbolicLink()).toBe(true);
    const installedPackage = JSON.parse(
      readFileSync(
        join(
          directory,
          "node_modules",
          "@robertsmieja",
          "xmatters-mcp",
          "package.json",
        ),
        "utf8",
      ),
    );
    expect(installedPackage.version).toBe("0.2.0");
    server = await startCli({
      entrypoint: installedBin,
      cwd: directory,
      installedBin: true,
    });
    const { client, transport } = makeClient(server.url);
    try {
      await client.connect(transport, requestOptions);
      expect(client.getProtocolEra()).toBe("modern");
      expect(client.getServerVersion()).toMatchObject({
        name: "xmatters-mcp",
        version: "0.2.0",
      });
      expect(transport.sessionId).toBeUndefined();
      const listed = await client.listTools(undefined, requestOptions);
      expect(listed.tools).toHaveLength(179);
      expect(listed.tools.map((tool) => tool.name)).toEqual(
        operations.map((op) => op.id),
      );
      const result = await client.callTool(
        {
          name: "xmatters_get_people",
          arguments: { query: { limit: 1 } },
        },
        requestOptions,
      );
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual({
        data: { data: [{ id: "synthetic-person" }], count: 1, total: 1 },
      });
    } finally {
      await client.close();
    }
    expect(await server.stop()).toEqual({ code: 0, signal: null });
    expect(server.stdout()).toBe("");
    expect(server.stderr()).toBe(`xmatters-mcp: listening on ${server.url}\n`);
  });

  it("fails closed with missing configuration through the installed executable", () => {
    const child = missingConfig({
      entrypoint: installedBin,
      cwd: directory,
      installedBin: true,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.signal).toBeNull();
    expect(child.stdout).toBe("");
    expect(child.stderr).toBe(
      "xmatters-mcp: startup failed; check XMATTERS_* configuration and transport. No credentials are logged.\n",
    );
  });
});
