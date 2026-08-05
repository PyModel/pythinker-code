{
  description = "Pythinker Code CLI";

  inputs = {
    # nixos-unstable ships Node.js 26, required by the workspace engine floor.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems =
        f:
        lib.genAttrs systems (
          system:
          f (import nixpkgs {
            inherit system;
          })
        );

      minNodeVersion = "26.4.0";

      # Hardcode to Node.js 26.x; fail the evaluation if the pinned nixpkgs
      # does not offer a new enough 26.x.
      nodejsFor =
        pkgs:
        let
          node = pkgs.nodejs_26;
        in
        if lib.versionAtLeast node.version minNodeVersion then
          node
        else
          throw ''
            Pythinker Code requires Node.js >= ${minNodeVersion},
            but nixpkgs only offers ${node.version}.
            Pin a newer nixpkgs revision or update minNodeVersion in flake.nix.
          '';

      pnpmFor =
        pkgs:
        pkgs.pnpm_10.override {
          nodejs = nodejsFor pkgs;
        };

      # -------------------------------------------------------------------
      # Workspace members (kept in sync with pnpm-workspace.yaml).
      #
      # HARD REQUIREMENT: whenever you add or remove a workspace package,
      # you MUST update both lists below. Missing a path will break the Nix
      # build (src fileset silently drops files); missing a name will break
      # pnpmConfigHook (dependencies for that workspace won't be fetched).
      # -------------------------------------------------------------------
      workspacePaths = [
        ./packages/acp-adapter
        ./packages/agent-core
        ./packages/server
        ./packages/server-e2e
        ./packages/kaos
        ./packages/pythinker-migration-legacy
        ./packages/kosong
        ./packages/migration-legacy
        ./packages/node-sdk
        ./packages/oauth
        ./packages/protocol
        ./packages/telemetry
        ./apps/pythinker-code
        ./apps/pythinker-web
        ./apps/dashboard
        ./apps/dashboard/server
        ./apps/dashboard/web
        ./docs
      ];

      workspaceNames = [
        "@pythoughts/acp-adapter"
        "@pythoughts/agent-core"
        "@pythoughts/server"
        "@pythoughts/server-e2e"
        "@pythoughts/kaos"
        "@pythoughts/kosong"
        "@pythoughts/migration-legacy"
        "@pythoughts/pythinker-code-sdk"
        "@pythoughts/pythinker-code-oauth"
        "@pythoughts/protocol"
        "@pythoughts/pythinker-telemetry"
        "@pythoughts/pythinker-code"
        "@pythoughts/pythinker-web"
        "@pythoughts/dashboard"
        "@pythoughts/dashboard-server"
        "@pythoughts/dashboard-web"
        "pythinker-code-docs"
        "pythinker-migration-legacy"
      ];
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          nodejs = nodejsFor pkgs;
          pnpm = pnpmFor pkgs;
          appPackageJson = builtins.fromJSON (builtins.readFile ./apps/pythinker-code/package.json);
          nativeTarget =
            if pkgs.stdenv.hostPlatform.isLinux && pkgs.stdenv.hostPlatform.isAarch64 then
              "linux-arm64"
            else if pkgs.stdenv.hostPlatform.isLinux then
              "linux-x64"
            else if pkgs.stdenv.hostPlatform.isDarwin && pkgs.stdenv.hostPlatform.isAarch64 then
              "darwin-arm64"
            else if pkgs.stdenv.hostPlatform.isDarwin then
              "darwin-x64"
            else
              throw "Unsupported Pythinker Code native target for ${pkgs.stdenv.hostPlatform.system}";

          pythinker-code = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "pythinker-code";
            version = appPackageJson.version;

            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions (
                [
                  ./build
                  ./.npmrc
                  ./.nvmrc
                  ./package.json
                  ./pnpm-lock.yaml
                  ./pnpm-workspace.yaml
                  ./tsconfig.json
                  ./vitest.config.ts
                  ./LICENSE
                ]
                ++ workspacePaths
              );
            };

            pnpmWorkspaces = [ "." ] ++ workspaceNames;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src pnpmWorkspaces;
              inherit pnpm;
              fetcherVersion = 3;
              hash = "sha256-zTjp/On758iWGAWAYAIBUXF+pRkUWsUSOg/38LHoCw4=";
            };

            nativeBuildInputs = [
              nodejs
              pnpm
              (pkgs.pnpmConfigHook.override { inherit pnpm; })
              pkgs.makeWrapper
            ]
            # The SEA inject step (postject) invalidates the macOS code
            # signature on the copied Node executable; build.mjs then re-applies
            # an ad-hoc signature via `codesign`. The Nix darwin sandbox does
            # not expose /usr/bin/codesign, so we supply nixpkgs' ad-hoc-only
            # replacement instead.
            ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
              pkgs.darwin.sigtool
            ];

            # The SEA binary is produced by `postject`-injecting a blob into a
            # plain Node executable. Stripping rewrites section tables and can
            # invalidate the injected blob's offsets, so leave the binary
            # untouched after the build.
            dontStrip = true;

            buildPhase = ''
              runHook preBuild
              export PYTHINKER_CODE_BUILD_TARGET=${nativeTarget}
              ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
                # pkgs.darwin.sigtool's codesign supports `--sign -` (ad-hoc)
                # but not the inspection mode (`-dv`) that 05-verify.mjs runs
                # afterwards. Disable the verify step for the Nix build; the
                # release CI keeps it via the unmodified script.
                substituteInPlace apps/pythinker-code/scripts/native/build.mjs \
                  --replace-fail \
                    "await runVerifyStep({ requireGatekeeper: false });" \
                    "// runVerifyStep skipped in nix sandbox (sigtool lacks -dv)"
              ''}
              # The SEA blob step (scripts/native/02-sea-blob.mjs) embeds the
              # Pythinker web assets from apps/pythinker-code/dist-web and fails if that
              # directory is missing. Build the web app and stage its assets
              # before producing the native executable.
              pnpm --filter=@pythoughts/pythinker-web run build
              node apps/pythinker-code/scripts/copy-web-assets.mjs
              pnpm --filter=@pythoughts/pythinker-code run build:native:sea
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              install -Dm755 \
                "apps/pythinker-code/dist-native/bin/${nativeTarget}/pythinker" \
                "$out/bin/pythinker"

              runHook postInstall
            '';

            postInstall = ''
              wrapProgram $out/bin/pythinker --prefix PATH : ${lib.makeBinPath [ pkgs.ripgrep pkgs.fd ]}
            '';

            meta = {
              description = "Pythinker Code CLI";
              homepage = "https://github.com/Pythoughts-labs/pythinker-code";
              license = lib.licenses.mit;
              mainProgram = "pythinker";
              platforms = systems;
            };
          });
        in
        {
          inherit pythinker-code;
          default = pythinker-code;
        }
      );

      apps = forAllSystems (pkgs: {
        pythinker-code = {
          type = "app";
          program = "${self.packages.${pkgs.system}.pythinker-code}/bin/pythinker";
        };
        default = self.apps.${pkgs.system}.pythinker-code;
      });

      devShells = forAllSystems (pkgs: {
        default =
          let
            nodejs = nodejsFor pkgs;
            pnpm = pnpmFor pkgs;
          in
          pkgs.mkShell {
            packages = [
              nodejs
              pnpm
              pkgs.ripgrep
              pkgs.fd
            ];
          };
      });
    };
}
