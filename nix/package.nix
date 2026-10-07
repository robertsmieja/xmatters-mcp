{
  lib,
  buildNpmPackage,
  nodejs_24,
}:

buildNpmPackage {
  pname = "xmatters-mcp";
  inherit ((lib.importJSON ../package.json)) version;
  nodejs = nodejs_24;
  src = lib.fileset.toSource {
    root = ../.;
    # Positive allowlist: never copy .env, node_modules or local build outputs.
    fileset = lib.fileset.unions [
      ../package.json
      ../package-lock.json
      ../tsconfig.json
      ../tsconfig.build.json
      ../src
      ../README.md
      ../LICENSE
      ../NOTICE
      ../SECURITY.md
      ../CONTRIBUTING.md
      ../docs
    ];
  };
  npmDepsHash = "sha256-YVXBkfCzZn4n/e4ag8zJcE2Bi4bwaOCiSHmsPXaFcOw=";
  npmPackFlags = [ "--ignore-scripts" ];

  meta = {
    description = "Safety-first xMatters REST API MCP server";
    license = lib.licenses.asl20;
    platforms = lib.platforms.linux;
    mainProgram = "xmatters-mcp";
  };
}
