{
  pkgs ? import <nixpkgs> { },
}:
with pkgs;
mkShell {
  name = "echo-next-dev";

  nativeBuildInputs = [
    # Build toolchain
    nodejs_22
    cmake
    gcc
    gnumake
    pkg-config
    python3
    binutils
    fakeroot
    dpkg
    rpm
    makeWrapper
    jq

    # Audio system
    alsa-lib

    # Electron runtime deps
    nss
    nspr
    libxscrnsaver
    libxtst
    libdrm
    libgbm
    mesa

    # electron-builder & packaging
    zip
    unzip
    p7zip
    electron_42

    # Audio tools
    ffmpeg

    # Desktop schemas
    gsettings-desktop-schemas
    glib

    # AppImage
    fuse2
    fuse3
  ];

  ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  PLAYWRIGHT_SKIP_BINARY_DOWNLOAD = "1";

  shellHook = ''
    export ALSA_CONFIG_PATH="${pkgs.alsa-lib}/share/alsa/alsa.conf"
    echo "🎵 ECHO NEXT — development shell"
    echo "   Node $(node --version)  |  npm $(npm --version)"
    echo "   Electron: ${pkgs.electron_42}/bin/electron"
    echo ""
    echo "   Commands:"
    echo "     npm run dev        — Start dev server"
    echo "     npm run typecheck  — TypeScript check"
    echo "     npm run build      — Production build"
    echo "     npm run test       — Run tests"
    echo "     npm run build:linux — Build Linux packages"
  '';
}
