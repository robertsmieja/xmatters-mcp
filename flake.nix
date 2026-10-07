{
  description = "xMatters MCP server and opt-in isolated VM acceptance test";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          server = pkgs.callPackage ./nix/package.nix { };
        in
        {
          default = server;
          xmatters-mcp = server;
          # Deliberately not a flake check: expensive VM tests are opt-in.
          e2e = pkgs.callPackage ./nix/e2e.nix { inherit server; };
        }
      );
      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
