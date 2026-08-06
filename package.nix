{
  lib,
  buildNpmPackage,
  makeWrapper,
  autoPatchelfHook,
  copyDesktopItems,
  makeDesktopItem,

  python3,
  pkg-config,
  stdenv,
  nodejs_22,

  electron_42,

  alsa-lib,
  freetype,
  fontconfig,
  libX11,
  libXcomposite,
  libXcursor,
  libXext,
  libXinerama,
  libXrandr,
  libXrender,
  gtk3,
  nss,
  nspr,
  libxscrnsaver,
  libxtst,
  libdrm,
  libgbm,
  mesa,
  glib,
  pango,
  cairo,
  atk,
  at-spi2-atk,
  at-spi2-core,
  cups,
  dbus,
  libxkbcommon,
  wayland,
  libGL,
  expat,
  zlib,
  gsettings-desktop-schemas,

  version ? "26.6.20",
}:

let
  electron = electron_42;

  runtimeLibs = [
    alsa-lib
    freetype
    fontconfig

    libX11
    libXcomposite
    libXcursor
    libXext
    libXinerama
    libXrandr
    libXrender

    gtk3
    nss
    nspr

    libxscrnsaver
    libxtst

    libdrm
    libgbm
    mesa

    glib
    pango
    cairo
    atk

    at-spi2-atk
    at-spi2-core
    cups
    dbus

    libxkbcommon
    wayland

    libGL
    expat
    zlib

    gsettings-desktop-schemas
  ];

  runtimeLibPath = lib.makeLibraryPath runtimeLibs;
in
buildNpmPackage {
  pname = "echo-next";
  inherit version;

  src = lib.cleanSource ./.;

  nodejs = nodejs_22;
  npmDepsHash = "sha256-S9ryb08EK9/Nojt+xv/UaKmySYqCVN4Xhx1QNHdNTec=";

  makeCacheWritable = true;
  forceGitDeps = true;

  npmFlags = [ "--ignore-scripts" ];

  ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  PLAYWRIGHT_SKIP_BINARY_DOWNLOAD = "1";

  nativeBuildInputs = [
    makeWrapper
    autoPatchelfHook
    copyDesktopItems
    python3
    pkg-config
    stdenv.cc
  ];

  buildInputs = runtimeLibs;
  autoPatchelfIgnoreMissingDeps = [ "*" ];
  dontNpmBuild = true;

  buildPhase = ''
    runHook preBuild

    node scripts/patch-better-sqlite3-electron42.cjs

    pushd node_modules/better-sqlite3 >/dev/null
    env -u npm_config_nodedir HOME="$TMPDIR" \
      node ../node-gyp/bin/node-gyp.js rebuild \
        --release \
        --runtime=electron \
        --target=${electron.version} \
        --nodedir=${electron.headers} \
        --verbose
    popd >/dev/null

    npm run build

    rm -rf node_modules/@img/sharp-linuxmusl-x64 node_modules/@img/sharp-libvips-linuxmusl-x64

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    appDir="$out/share/echo-next"
    mkdir -p "$appDir"

    cp -r out "$appDir/"
    cp package.json "$appDir/"
    cp -r node_modules "$appDir/"
    cp -r build-resources "$appDir/"

    install -Dm644 \
      build-resources/icons/software.png \
      "$out/share/icons/hicolor/256x256/apps/echo-next.png"

    install -Dm644 \
      build-resources/icons/logo.png \
      "$out/share/icons/hicolor/512x512/apps/echo-next.png"

    mkdir -p "$out/bin"
    makeWrapper ${electron}/bin/electron \
      "$out/bin/echo-next" \
      --add-flags "$appDir" \
      --set-default LD_LIBRARY_PATH "${runtimeLibPath}"

    runHook postInstall
  '';

  postFixup = ''
    while IFS= read -r -d "" file; do
      if file "$file" | grep -q ELF; then
        patchelf \
          --set-rpath "${runtimeLibPath}" \
          "$file" || true
      fi
    done < <(
      find "$out" \
        \( -name "*.node" -o -name "*.so" \) \
        -print0
    )
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "echo-next";
      desktopName = "ECHO NEXT";
      exec = "echo-next %U";
      icon = "echo-next";
      comment = "Desktop music player focused on local libraries and HiFi output";
      categories = [
        "AudioVideo"
        "Audio"
      ];
      mimeTypes = [
        "audio/mpeg"
        "audio/flac"
        "audio/wav"
        "audio/mp4"
        "audio/aac"
        "audio/ogg"
        "audio/opus"
        "audio/wma"
        "audio/aiff"
        "audio/ape"
        "audio/dsf"
        "audio/dff"
        "audio/x-mpegurl"
        "audio/x-scpls"
      ];
      startupWMClass = "echo-next";
    })
  ];

  meta = {
    description = "Desktop music player for local libraries and HiFi output";
    homepage = "https://echonagi.com";
    mainProgram = "echo-next";
    platforms = lib.platforms.linux;
    license = lib.licenses.lgpl3Only;
  };
}
