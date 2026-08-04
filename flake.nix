{
  description = "ECHO NEXT source-available desktop music player";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      inherit (nixpkgs) lib;

      pkgsFor = system: nixpkgs.legacyPackages.${system} or (import nixpkgs { inherit system; });

      supportedSystems = builtins.filter (
        system: (builtins.tryEval (pkgsFor system).stdenv.hostPlatform).success
      ) lib.systems.doubles.linux;

      forAllSystems = function: lib.genAttrs supportedSystems (system: function (pkgsFor system));
    in
    {
      overlays.default = final: _: {
        echo-next = final.callPackage ./package.nix { };
      };

      packages = forAllSystems (pkgs: {
        echo-next = pkgs.callPackage ./package.nix { };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.echo-next;
      });

      devShells = forAllSystems (pkgs: {
        default = import ./shell.nix { inherit pkgs; };
      });
    };
}
