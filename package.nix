# echo-audio-daemon (CMake + pkg-config, no network) 在 buildPhase 内构建。
# better-sqlite3 native ABI 已在 buildPhase 中用 nixpkgs 提供的 ${electron.headers} 离线 rebuild。
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
  cmake,
  ffmpeg,
  libebur128,
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

  version ? "26.6.14",
}:

let
  electron = electron_42;

  runtimeLibs = [
    alsa-lib
    ffmpeg
    libebur128
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

  # postinstall (ensure-native-abi.mjs) 中的 electron-rebuild 走联网，沙箱里跑不通；
  # 用 `npm rebuild --runtime=electron --dist-url=file://${electron.headers}` 在 buildPhase
  # 内显式离线 rebuild better-sqlite3 取代之。其它包不需要 rebuild，省下 lifecycle 噪音。
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
    cmake
  ];

  buildInputs = runtimeLibs;

  autoPatchelfIgnoreMissingDeps = [ "*" ];

  dontNpmBuild = true;

  buildPhase = ''
    runHook preBuild

    # better-sqlite3 v12 需要 V8 14 兼容补丁，必须在 rebuild 之前打。
    node scripts/patch-better-sqlite3-electron42.cjs

    # 用 nixpkgs 自带的 electron headers 直接调 node-gyp 离线 rebuild。
    # npmConfigHook 通过 npm_config_nodedir 把 Node 22 source 注入了环境，
    # 优先级高于 --nodedir CLI；先 unset 再调 node-gyp 才会真正用 electron
    # headers 编译，从而与 electron 内置的 V8 14 ABI 链接。
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

    # autoPatchelfHook 会把 sharp-linux-x64.node 的 libvips RPATH 错绑到 musl 变种，
    # 运行期触发 ERR_DLOPEN_FAILED: libc.musl-x86_64.so.1。删掉 musl 变种，让 fixup
    # 阶段只能走 glibc 路径。
    rm -rf node_modules/@img/sharp-linuxmusl-x64 node_modules/@img/sharp-libvips-linuxmusl-x64

    # echo-audio-daemon: 标准 CMake + pkg-config，无网络依赖。
    cmake -B build native/echo-audio-daemon
    cmake --build build

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

    # Install echo-audio-daemon binary
    install -Dm755 build/src/echo-audio-daemon "$out/lib/echo-next/echo-audio-daemon"

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
        \( -name "*.node" -o -name "*.so" -o -name "echo-audio-daemon" \) \
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
    description = "Source-available desktop music player for local libraries and HiFi output";

    homepage = "https://echonagi.com";

    mainProgram = "echo-next";

    platforms = lib.platforms.linux;

    license = lib.licenses.unfree;
  };
}
