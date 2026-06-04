import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const require = createRequire(import.meta.url);

const fail = (message, details = []) => {
  console.error(`[build:airplay-raop] ${message}`);
  for (const detail of details) {
    console.error(`[build:airplay-raop] ${detail}`);
  }
  process.exitCode = 1;
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
};

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const findVisualStudio = () => {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (!existsSync(vswhere)) {
    return null;
  }

  const result = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.Component.MSBuild', '-property', 'installationPath'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  const installationPath = result.stdout.trim();
  if (!installationPath) {
    return null;
  }

  const msbuild = join(installationPath, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe');
  const vcToolsDir = join(installationPath, 'VC', 'Tools', 'MSVC');
  if (!existsSync(msbuild) || !existsSync(vcToolsDir)) {
    return null;
  }

  const tools = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `$ErrorActionPreference='Stop'; Get-ChildItem -LiteralPath '${vcToolsDir.replaceAll("'", "''")}' -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName`,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  const latestVcTools = tools.status === 0 ? tools.stdout.trim() : '';
  const vcBin = latestVcTools ? join(latestVcTools, 'bin', 'Hostx64', 'x64') : null;
  return { installationPath, msbuild, vcToolsDir, vcBin: vcBin && existsSync(join(vcBin, 'cl.exe')) ? vcBin : null };
};

const opensslCandidates = [
  process.env.OPENSSL_ROOT_DIR,
  process.env.OPENSSL_DIR,
  'C:\\Program Files\\OpenSSL-Win64',
  'C:\\Program Files (x86)\\OpenSSL-Win64',
  'C:\\vcpkg\\installed\\x64-windows',
].filter(Boolean);

const findOpenSsl = () => {
  for (const root of opensslCandidates) {
    const include = join(root, 'include', 'openssl', 'ssl.h');
    const lib = join(root, 'lib');
    if (existsSync(include) && existsSync(lib)) {
      return root;
    }
  }

  return null;
};

const findGitBash = () => {
  const candidates = [
    'F:\\Git\\bin',
    'F:\\Git\\usr\\bin',
    'C:\\Program Files\\Git\\bin',
    'C:\\Program Files\\Git\\usr\\bin',
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'bash.exe'))) ?? null;
};

const findPython = () => {
  const candidates = [
    process.env.PYTHON,
    'C:\\Users\\Moe\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const result = spawnSync('where.exe', ['python'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return result.status === 0
    ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
    : null;
};

const createPython3Shim = (pythonPath) => {
  const shimDir = join(projectRoot, '.codex-tmp', 'airplay-build-bin');
  mkdirSync(shimDir, { recursive: true });
  const shim = join(shimDir, 'python3');
  const bashPath = pythonPath.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
  writeFileSync(shim, `#!/usr/bin/env bash\nexec "${bashPath}" "$@"\n`, 'utf8');
  chmodSync(shim, 0o755);
  return shimDir;
};

const toGypPath = (path) => path.replaceAll('\\', '/');

const patchNodeLibraopWindowsBuild = (openSslRoot) => {
  const packageRoot = dirname(require.resolve('@lox-audioserver/node-libraop/package.json'));
  const queueStubPath = join(packageRoot, 'native', 'raop_client_queue_stub.c');
  writeFileSync(queueStubPath, [
    '#include <stdint.h>',
    'struct raopcl_s;',
    'uint32_t raopcl_queue_len(struct raopcl_s *p) { (void)p; return 0; }',
    'uint32_t raopcl_queued_frames(struct raopcl_s *p) { (void)p; return 0; }',
    '',
  ].join('\n'), 'utf8');

  const bindingPath = join(packageRoot, 'binding.gyp');
  let binding = readFileSync(bindingPath, 'utf8');
  if (!binding.includes('native/raop_client_queue_stub.c')) {
    binding = binding.replace(
      '"native/log_stub.c",',
      '"native/log_stub.c",\n        "native/raop_client_queue_stub.c",',
    );
  }
  const includeDir = toGypPath(join(openSslRoot, 'include'));
  if (!binding.includes(includeDir)) {
    binding = binding.replace(
      '"native",',
      `"${includeDir}",\n        "native",`,
    );
  }
  const libPaths = [
    toGypPath(join(openSslRoot, 'lib', 'libssl.lib')),
    toGypPath(join(openSslRoot, 'lib', 'libcrypto.lib')),
    toGypPath(join(openSslRoot, 'lib', 'pthreadVC3.lib')),
  ];
  for (const libPath of libPaths) {
    if (!binding.includes(libPath)) {
      binding = binding.replace(
        '"-lbcrypt"',
        `"${libPath}",\n            "-lbcrypt"`,
      );
    }
  }
  binding = binding
    .replace(/\s*"-lssl",?\r?\n/g, '')
    .replace(/\s*"-lcrypto",?\r?\n/g, '')
    .replace(/\s*"-lpthreadVC3",?\r?\n/g, '');
  if (!binding.includes('SSL_STATIC_LIB')) {
    binding = binding.replace(
      '"NAPI_DISABLE_CPP_EXCEPTIONS"',
      '"SSL_STATIC_LIB", "NAPI_DISABLE_CPP_EXCEPTIONS"',
    );
  }
  writeFileSync(bindingPath, binding, 'utf8');

  const platformPath = join(packageRoot, 'vendor', 'libraop', 'crosstools', 'src', 'platform.h');
  let platform = readFileSync(platformPath, 'utf8');
  if (!platform.includes('#include <sys/timeb.h>\n#include <pthread.h>')) {
    platform = platform.replace(
      '#include <sys/timeb.h>',
      '#include <sys/timeb.h>\n#include <pthread.h>',
    );
    writeFileSync(platformPath, platform, 'utf8');
  }

  const addonPath = join(packageRoot, 'native', 'addon.cc');
  let addon = readFileSync(addonPath, 'utf8');
  if (!addon.includes('#include "alac.h"')) {
    addon = addon.replace(
      '#include "raop_client.h"\n',
      '#include "raop_client.h"\n#include "alac.h"\n',
    );
  }
  addon = addon.replace(/\bcase RAOP_PCM:/g, 'case RAOP_RECEIVER_PCM:');
  if (addon.includes('#ifdef RAOP_PCM')) {
    addon = addon.replace(
      [
        '#ifdef RAOP_PCM',
        '    case RAOP_RECEIVER_PCM: {',
      ].join('\n'),
      '    case RAOP_RECEIVER_PCM: {',
    );
    addon = addon.replace(
      [
        '      break;',
        '    }',
        '#endif',
        '    default:',
      ].join('\n'),
      [
        '      break;',
        '    }',
        '    default:',
      ].join('\n'),
    );
  }
  if (!addon.includes('struct AlacDecoderInstance')) {
    addon = addon.replace(
      'static unsigned char HexByte(const std::string& hex, size_t idx) {',
      [
        'struct AlacDecoderInstance {',
        '  std::mutex mutex;',
        '  alac_file* decoder{nullptr};',
        '  int sampleRate{44100};',
        '  int sampleSize{16};',
        '  int channels{2};',
        '  int framesPerPacket{352};',
        '};',
        '',
        'static std::mutex g_alac_decoders_mutex;',
        'static std::map<int, std::shared_ptr<AlacDecoderInstance>> g_alac_decoders;',
        'static int g_next_alac_decoder_handle = 20000;',
        'static std::once_flag g_alac_decoder_cleanup_once;',
        '',
        'static void CleanupAlacDecoders(void*) {',
        '  std::lock_guard<std::mutex> guard(g_alac_decoders_mutex);',
        '  for (auto& kv : g_alac_decoders) {',
        '    auto inst = kv.second;',
        '    if (!inst) continue;',
        '    std::lock_guard<std::mutex> lock(inst->mutex);',
        '    if (inst->decoder) {',
        '      delete_alac(inst->decoder);',
        '      inst->decoder = nullptr;',
        '    }',
        '  }',
        '  g_alac_decoders.clear();',
        '}',
        '',
        'static void ConfigureAlacDecoder(alac_file* decoder, int sampleRate, int sampleSize, int channels, int framesPerPacket) {',
        '  decoder->setinfo_max_samples_per_frame = static_cast<uint32_t>(framesPerPacket);',
        '  decoder->setinfo_7a = 0;',
        '  decoder->setinfo_sample_size = static_cast<uint8_t>(sampleSize);',
        '  decoder->setinfo_rice_historymult = 40;',
        '  decoder->setinfo_rice_initialhistory = 10;',
        '  decoder->setinfo_rice_kmodifier = 14;',
        '  decoder->setinfo_7f = static_cast<uint8_t>(channels);',
        '  decoder->setinfo_80 = 255;',
        '  decoder->setinfo_82 = 0;',
        '  decoder->setinfo_86 = 0;',
        '  decoder->setinfo_8a_rate = static_cast<uint32_t>(sampleRate);',
        '  allocate_buffers(decoder);',
        '}',
        '',
        'static std::shared_ptr<AlacDecoderInstance> GetAlacDecoderInstance(int handle) {',
        '  std::lock_guard<std::mutex> guard(g_alac_decoders_mutex);',
        '  auto it = g_alac_decoders.find(handle);',
        '  return it == g_alac_decoders.end() ? nullptr : it->second;',
        '}',
        '',
        'Napi::Value StartAlacDecoder(const Napi::CallbackInfo& info) {',
        '  Napi::Env env = info.Env();',
        '  if (info.Length() < 1 || !info[0].IsObject()) {',
        '    Napi::TypeError::New(env, "startAlacDecoder(options) expected").ThrowAsJavaScriptException();',
        '    return env.Null();',
        '  }',
        '  Napi::Object opts = info[0].As<Napi::Object>();',
        '  int sampleRate = opts.Has("sampleRate") ? opts.Get("sampleRate").ToNumber().Int32Value() : 44100;',
        '  int sampleSize = opts.Has("sampleSize") ? opts.Get("sampleSize").ToNumber().Int32Value() : 16;',
        '  int channels = opts.Has("channels") ? opts.Get("channels").ToNumber().Int32Value() : 2;',
        '  int framesPerPacket = opts.Has("framesPerPacket") ? opts.Get("framesPerPacket").ToNumber().Int32Value() : 352;',
        '  if ((sampleRate != 44100 && sampleRate != 48000) || sampleSize != 16 || channels != 2 || framesPerPacket <= 0 || framesPerPacket > 4096) {',
        '    Napi::TypeError::New(env, "Only AirPlay2 ALAC 16-bit stereo at 44.1/48 kHz is supported").ThrowAsJavaScriptException();',
        '    return env.Null();',
        '  }',
        '  alac_file* decoder = create_alac(sampleSize, channels);',
        '  if (!decoder) {',
        '    Napi::Error::New(env, "create_alac failed").ThrowAsJavaScriptException();',
        '    return env.Null();',
        '  }',
        '  ConfigureAlacDecoder(decoder, sampleRate, sampleSize, channels, framesPerPacket);',
        '  auto inst = std::make_shared<AlacDecoderInstance>();',
        '  inst->decoder = decoder;',
        '  inst->sampleRate = sampleRate;',
        '  inst->sampleSize = sampleSize;',
        '  inst->channels = channels;',
        '  inst->framesPerPacket = framesPerPacket;',
        '  int handle = 0;',
        '  {',
        '    std::lock_guard<std::mutex> guard(g_alac_decoders_mutex);',
        '    handle = g_next_alac_decoder_handle++;',
        '    g_alac_decoders[handle] = inst;',
        '  }',
        '  std::call_once(g_alac_decoder_cleanup_once, [&]() {',
        '    env.AddCleanupHook([] { CleanupAlacDecoders(nullptr); });',
        '  });',
        '  return Napi::Number::New(env, handle);',
        '}',
        '',
        'Napi::Value DecodeAlacFrame(const Napi::CallbackInfo& info) {',
        '  Napi::Env env = info.Env();',
        '  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBuffer()) {',
        '    Napi::TypeError::New(env, "decodeAlacFrame(handle, frame) expected").ThrowAsJavaScriptException();',
        '    return env.Null();',
        '  }',
        '  int handle = info[0].ToNumber().Int32Value();',
        '  Napi::Buffer<uint8_t> frame = info[1].As<Napi::Buffer<uint8_t>>();',
        '  auto inst = GetAlacDecoderInstance(handle);',
        '  if (!inst) {',
        '    Napi::Error::New(env, "unknown ALAC decoder handle").ThrowAsJavaScriptException();',
        '    return env.Null();',
        '  }',
        '  std::lock_guard<std::mutex> lock(inst->mutex);',
        '  if (!inst->decoder) {',
        '    Napi::Error::New(env, "ALAC decoder is closed").ThrowAsJavaScriptException();',
        '    return env.Null();',
        '  }',
        '  size_t outputCapacity = static_cast<size_t>(inst->framesPerPacket) * static_cast<size_t>(inst->channels) * sizeof(int16_t) * 2;',
        '  if (outputCapacity < 8192) outputCapacity = 8192;',
        '  std::vector<uint8_t> output(outputCapacity);',
        '  int outputSize = 0;',
        '  decode_frame(inst->decoder, frame.Data(), output.data(), &outputSize);',
        '  if (outputSize <= 0) {',
        '    return Napi::Buffer<uint8_t>::Copy(env, output.data(), 0);',
        '  }',
        '  size_t safeSize = static_cast<size_t>(outputSize);',
        '  if (safeSize > output.size()) safeSize = output.size();',
        '  return Napi::Buffer<uint8_t>::Copy(env, output.data(), safeSize);',
        '}',
        '',
        'Napi::Value StopAlacDecoder(const Napi::CallbackInfo& info) {',
        '  Napi::Env env = info.Env();',
        '  if (info.Length() < 1 || !info[0].IsNumber()) {',
        '    Napi::TypeError::New(env, "stopAlacDecoder(handle) expected").ThrowAsJavaScriptException();',
        '    return env.Null();',
        '  }',
        '  int handle = info[0].ToNumber().Int32Value();',
        '  std::shared_ptr<AlacDecoderInstance> inst;',
        '  {',
        '    std::lock_guard<std::mutex> guard(g_alac_decoders_mutex);',
        '    auto it = g_alac_decoders.find(handle);',
        '    if (it != g_alac_decoders.end()) {',
        '      inst = it->second;',
        '      g_alac_decoders.erase(it);',
        '    }',
        '  }',
        '  if (!inst) return env.Null();',
        '  std::lock_guard<std::mutex> lock(inst->mutex);',
        '  if (inst->decoder) {',
        '    delete_alac(inst->decoder);',
        '    inst->decoder = nullptr;',
        '  }',
        '  return env.Null();',
        '}',
        '',
        'static unsigned char HexByte(const std::string& hex, size_t idx) {',
      ].join('\n'),
    );
  }
  if (!addon.includes('exports.Set("startAlacDecoder"')) {
    addon = addon.replace(
      '  exports.Set("setLogHandler", Napi::Function::New(env, SetLogHandler));',
      [
        '  exports.Set("startAlacDecoder", Napi::Function::New(env, StartAlacDecoder));',
        '  exports.Set("decodeAlacFrame", Napi::Function::New(env, DecodeAlacFrame));',
        '  exports.Set("stopAlacDecoder", Napi::Function::New(env, StopAlacDecoder));',
        '  exports.Set("setLogHandler", Napi::Function::New(env, SetLogHandler));',
      ].join('\n'),
    );
  }
  writeFileSync(addonPath, addon, 'utf8');

  const distIndexPath = join(packageRoot, 'dist', 'index.js');
  let distIndex = readFileSync(distIndexPath, 'utf8');
  if (!distIndex.includes('exports.startAlacDecoder = startAlacDecoder;')) {
    distIndex = distIndex
      .replace(
        'exports.setLogHandler = setLogHandler;',
        [
          'exports.startAlacDecoder = startAlacDecoder;',
          'exports.decodeAlacFrame = decodeAlacFrame;',
          'exports.stopAlacDecoder = stopAlacDecoder;',
          'exports.setLogHandler = setLogHandler;',
        ].join('\n'),
      )
      .replace(
        'function setLogHandler(handler, level = \'warn\', raopLevel, utilLevel) {',
        [
          'function startAlacDecoder(options) {',
          '    return bindings.startAlacDecoder(options);',
          '}',
          'function decodeAlacFrame(handle, frame) {',
          '    return bindings.decodeAlacFrame(handle, frame);',
          '}',
          'function stopAlacDecoder(handle) {',
          '    bindings.stopAlacDecoder(handle);',
          '}',
          'function setLogHandler(handler, level = \'warn\', raopLevel, utilLevel) {',
        ].join('\n'),
      );
    writeFileSync(distIndexPath, distIndex, 'utf8');
  }

  const distTypesPath = join(packageRoot, 'dist', 'index.d.ts');
  let distTypes = readFileSync(distTypesPath, 'utf8');
  if (!distTypes.includes('startAlacDecoder')) {
    distTypes = distTypes.replace(
      'export declare function pairWithAppleTvByIp(targetIp: string, port?: number): {',
      [
        'export type AlacDecoderOptions = {',
        '    sampleRate: number;',
        '    sampleSize: 16;',
        '    channels: 2;',
        '    framesPerPacket: number;',
        '};',
        'export declare function startAlacDecoder(options: AlacDecoderOptions): number;',
        'export declare function decodeAlacFrame(handle: number, frame: Buffer): Buffer;',
        'export declare function stopAlacDecoder(handle: number): void;',
        'export declare function pairWithAppleTvByIp(targetIp: string, port?: number): {',
      ].join('\n'),
    );
    writeFileSync(distTypesPath, distTypes, 'utf8');
  }

  const serverHeaderPath = join(packageRoot, 'vendor', 'libraop', 'src', 'raop_server.h');
  let serverHeader = readFileSync(serverHeaderPath, 'utf8');
  serverHeader = serverHeader.replace(/\bRAOP_PCM\b/g, 'RAOP_RECEIVER_PCM');
  if (!serverHeader.includes('RAOP_RECEIVER_PCM')) {
    serverHeader = serverHeader.replace(
      'typedef enum { RAOP_STREAM, RAOP_PLAY, RAOP_FLUSH, RAOP_PAUSE, RAOP_STOP, RAOP_VOLUME, RAOP_METADATA, RAOP_ARTWORK } raopsr_event_t ;',
      'typedef enum { RAOP_STREAM, RAOP_PLAY, RAOP_FLUSH, RAOP_PAUSE, RAOP_STOP, RAOP_VOLUME, RAOP_METADATA, RAOP_ARTWORK, RAOP_RECEIVER_PCM } raopsr_event_t ;',
    );
  }
  writeFileSync(serverHeaderPath, serverHeader, 'utf8');

  const streamerHeaderPath = join(packageRoot, 'vendor', 'libraop', 'src', 'raop_streamer.h');
  let streamerHeader = readFileSync(streamerHeaderPath, 'utf8');
  if (!streamerHeader.includes('RAOP_STREAMER_PCM')) {
    streamerHeader = streamerHeader
      .replace(
        'typedef enum { RAOP_STREAMER_PLAY } raopst_event_t;',
        'typedef enum { RAOP_STREAMER_PLAY, RAOP_STREAMER_PCM } raopst_event_t;',
      )
      .replace(
        'typedef\tvoid (*raopst_cb_t)(void *owner, raopst_event_t event);',
        'typedef\tvoid (*raopst_cb_t)(void *owner, raopst_event_t event, ...);',
      );
    writeFileSync(streamerHeaderPath, streamerHeader, 'utf8');
  }

  const streamerPath = join(packageRoot, 'vendor', 'libraop', 'src', 'raop_streamer.c');
  let streamer = readFileSync(streamerPath, 'utf8');
  if (!streamer.includes('RAOP direct PCM frame')) {
    streamer = streamer.replace(
      [
        '\t\t// just discard all silences frames at the beginning (might be an iOS flush + silence)',
        '\t\tif (silence && ctx->ab_write - ctx->ab_read > 1) ctx->audio_buffer[BUFIDX(ctx->ab_read++)].ready = false;',
        '',
        '\t\tif (ctx->state == RTP_PLAY && ctx->silence && !silence) {',
      ].join('\n'),
      [
        '\t\t// just discard all silences frames at the beginning (might be an iOS flush + silence)',
        '\t\tif (silence && ctx->ab_write - ctx->ab_read > 1) ctx->audio_buffer[BUFIDX(ctx->ab_read++)].ready = false;',
        '',
        '\t\tif (ctx->state == RTP_PLAY && abuf->len > 0) {',
        '\t\t\tLOG_SDEBUG("[%p]: RAOP direct PCM frame %d bytes", ctx, abuf->len);',
        '\t\t\tctx->event_cb(ctx->owner, RAOP_STREAMER_PCM, (uint8_t*) abuf->data, (size_t) abuf->len);',
        '\t\t}',
        '',
        '\t\tif (ctx->state == RTP_PLAY && ctx->silence && !silence) {',
      ].join('\n'),
    );
    writeFileSync(streamerPath, streamer, 'utf8');
  }

  const serverPath = join(packageRoot, 'vendor', 'libraop', 'src', 'raop_server.c');
  let server = readFileSync(serverPath, 'utf8');
  server = server.replace(/\bRAOP_PCM\b/g, 'RAOP_RECEIVER_PCM');
  if (!server.includes('#include <stdarg.h>')) {
    server = server.replace('#include <string.h>\n', '#include <string.h>\n#include <stdarg.h>\n');
  }
  if (!server.includes('RAOP_STREAMER_PCM')) {
    server = server.replace(
      [
        'static void event_cb(void *owner, raopst_event_t event) {',
        '\traopsr_t *ctx = (raopsr_t*) owner;',
        '',
        '\tswitch(event) {',
        '\t\tcase RAOP_STREAMER_PLAY:',
        '\t\t\tctx->raop_cb(ctx->owner, RAOP_PLAY, (uint32_t) ctx->hport);',
        '\t\t\t// in case of play after FLUSH, usually no metadata is re-sent',
        '\t\t\tif (ctx->metadata.title) ctx->raop_cb(ctx->owner, RAOP_METADATA, &ctx->metadata);',
        '\t\t\tbreak;',
        '\t\tdefault:',
      ].join('\n'),
      [
        'static void event_cb(void *owner, raopst_event_t event, ...) {',
        '\traopsr_t *ctx = (raopsr_t*) owner;',
        '',
        '\tswitch(event) {',
        '\t\tcase RAOP_STREAMER_PLAY:',
        '\t\t\tctx->raop_cb(ctx->owner, RAOP_PLAY, (uint32_t) ctx->hport);',
        '\t\t\t// in case of play after FLUSH, usually no metadata is re-sent',
        '\t\t\tif (ctx->metadata.title) ctx->raop_cb(ctx->owner, RAOP_METADATA, &ctx->metadata);',
        '\t\t\tbreak;',
        '\t\tcase RAOP_STREAMER_PCM: {',
        '\t\t\tva_list args;',
        '\t\t\tva_start(args, event);',
        '\t\t\tuint8_t *data = va_arg(args, uint8_t*);',
        '\t\t\tsize_t len = va_arg(args, size_t);',
        '\t\t\tif (data && len > 0) ctx->raop_cb(ctx->owner, RAOP_RECEIVER_PCM, data, len);',
        '\t\t\tva_end(args);',
        '\t\t\tbreak;',
        '\t\t}',
        '\t\tdefault:',
      ].join('\n'),
    );
  }
  server = server.replace(
    'port.offset = rand() % port_range;',
    'port.offset = 0;',
  );
  if (!server.includes('response_body_len')) {
    server = server.replace(
      '\tchar *response = NULL;\n',
      '\tchar *response = NULL;\n\tchar *response_body = NULL;\n\tint response_body_len = 0;\n',
    );
  }
  if (!server.includes('got_rtsp_request')) {
    server = server.replace(
      [
        'static void *rtsp_thread(void *arg) {',
        '\traopsr_t *ctx = (raopsr_t*) arg;',
        '\tint  sock = -1;',
      ].join('\n'),
      [
        'static void *rtsp_thread(void *arg) {',
        '\traopsr_t *ctx = (raopsr_t*) arg;',
        '\tint  sock = -1;',
        '\tbool got_rtsp_request = false;',
        '\tunsigned idle_poll_count = 0;',
      ].join('\n'),
    );
    server = server.replace(
      [
        '\t\t\tif (sock != -1 && ctx->running) {',
        '\t\t\t\tLOG_INFO("got RTSP connection %u", sock);',
        '\t\t\t} else continue;',
      ].join('\n'),
      [
        '\t\t\tif (sock != -1 && ctx->running) {',
        '\t\t\t\tgot_rtsp_request = false;',
        '\t\t\t\tidle_poll_count = 0;',
        '\t\t\t\tLOG_INFO("got RTSP connection %u", sock);',
        '\t\t\t} else continue;',
      ].join('\n'),
    );
    server = server.replace(
      [
        '\t\tif (!n) continue;',
        '',
        '\t\tif (n > 0) res = handle_rtsp(ctx, sock);',
      ].join('\n'),
      [
        '\t\tif (!n) {',
        '\t\t\tif (!got_rtsp_request && ++idle_poll_count >= 20) {',
        '\t\t\t\tLOG_INFO("RTSP idle probe close %u", sock);',
        '\t\t\t\tclosesocket(sock);',
        '\t\t\t\tsock = -1;',
        '\t\t\t}',
        '\t\t\tcontinue;',
        '\t\t}',
        '',
        '\t\tidle_poll_count = 0;',
        '\t\tif (n > 0) {',
        '\t\t\tres = handle_rtsp(ctx, sock);',
        '\t\t\tif (res) got_rtsp_request = true;',
        '\t\t}',
      ].join('\n'),
    );
  }
  if (!server.includes('challenge_host')) {
    server = server.replace(
      '\t\tp = data + min(base64_decode(buf_pad, data), 32-10);\n\t\tp = (char*) memcpy(p, &ctx->host, 4) + 4;',
      [
        '\t\tp = data + min(base64_decode(buf_pad, data), 32-10);',
        '\t\tstruct sockaddr_in local_addr;',
        '\t\tsocklen_t local_addr_len = sizeof(local_addr);',
        '\t\tstruct in_addr challenge_host = ctx->host;',
        '\t\tif (challenge_host.s_addr == htonl(INADDR_ANY) &&',
        '\t\t\tgetsockname(sock, (struct sockaddr*) &local_addr, &local_addr_len) == 0) {',
        '\t\t\tchallenge_host = local_addr.sin_addr;',
        '\t\t}',
        '\t\tp = (char*) memcpy(p, &challenge_host, 4) + 4;',
      ].join('\n'),
    );
  }
  const getParameterBranch = [
    '\t} else if (!strcmp(method, "GET_PARAMETER")) {',
    '\t\tif (body && strcasestr(body, "volume") != NULL) {',
    '\t\t\tresponse_body = strdup("volume: 0.000000\\r\\n");',
    '\t\t\tresponse_body_len = strlen(response_body);',
    '\t\t\tkd_add(resp, "Content-Type", "text/parameters");',
    '\t\t\tkd_vadd(resp, "Content-Length", "%d", response_body_len);',
    '\t\t\tLOG_INFO("[%p]: GET PARAMETER volume response", ctx);',
    '\t\t} else {',
    '\t\t\tkd_add(resp, "Content-Length", "0");',
    '\t\t\tLOG_INFO("[%p]: GET PARAMETER keepalive", ctx);',
    '\t\t}',
    '\t} else if (!strcmp(method, "SET_PARAMETER")) {',
  ].join('\n');
  const oldGetParameterBranch = [
    '\t} else if (!strcmp(method, "GET_PARAMETER")) {',
    '\t\t// AirPlay clients poll GET_PARAMETER during startup; an empty 200 OK keeps the RTSP session alive.',
    '\t\tLOG_INFO("[%p]: GET PARAMETER keepalive", ctx);',
    '\t} else if (!strcmp(method, "SET_PARAMETER")) {',
  ].join('\n');
  if (server.includes(oldGetParameterBranch) && !server.includes('GET PARAMETER volume response')) {
    server = server.replace(oldGetParameterBranch, getParameterBranch);
  }
  if (!server.includes('GET PARAMETER volume response')) {
    server = server.replace(
      '\t} else if (!strcmp(method, "SET_PARAMETER")) {',
      getParameterBranch,
    );
  }
  if (!server.includes('response_body_len > 0')) {
    server = server.replace(
      [
        '\tif (!response) buf = http_send(sock, "RTSP/1.0 200 OK", resp);',
        '\telse buf = http_send(sock, response, NULL);',
      ].join('\n'),
      [
        '\tif (!response) {',
        '\t\tbuf = http_send(sock, "RTSP/1.0 200 OK", resp);',
        '\t\tif (buf && response_body && response_body_len > 0) {',
        '\t\t\tint sent = send(sock, response_body, response_body_len, 0);',
        '\t\t\tif (sent != response_body_len) LOG_ERROR("RTSP response body send() error %d/%d", sent, response_body_len);',
        '\t\t\tsize_t header_len = strlen(buf);',
        '\t\t\tchar *with_body = malloc(header_len + response_body_len + 1);',
        '\t\t\tif (with_body) {',
        '\t\t\t\tmemcpy(with_body, buf, header_len);',
        '\t\t\t\tmemcpy(with_body + header_len, response_body, response_body_len);',
        '\t\t\t\twith_body[header_len + response_body_len] = \'\\0\';',
        '\t\t\t\tNFREE(buf);',
        '\t\t\t\tbuf = with_body;',
        '\t\t\t}',
        '\t\t}',
        '\t} else buf = http_send(sock, response, NULL);',
      ].join('\n'),
    );
  }
  if (!server.includes('NFREE(response_body);')) {
    server = server.replace(
      '\tNFREE(body);\n',
      '\tNFREE(response_body);\n\tNFREE(body);\n',
    );
  }
  server = server.replace(
    [
      '\t\tht = raopst_init(ctx->host, ctx->peer, ctx->streamer.codec, ctx->streamer.metadata, ctx->drift, true, ctx->latencies,',
      '\t\t\t\t\t\t\tctx->rtsp.aeskey, ctx->rtsp.aesiv, ctx->rtsp.fmtp,',
      '\t\t\t\t\t\t\tcport, tport, ctx, event_cb, http_cb, ctx->ports.base,',
      '\t\t\t\t\t\t\tctx->ports.range, ctx->http_length);',
    ].join('\n'),
    [
      '\t\tunsigned short stream_base = ctx->ports.base ? ctx->ports.base + 1 : 0;',
      '\t\tunsigned short stream_range = ctx->ports.range > 1 ? ctx->ports.range - 1 : ctx->ports.range;',
      '\t\tht = raopst_init(ctx->host, ctx->peer, ctx->streamer.codec, ctx->streamer.metadata, ctx->drift, true, ctx->latencies,',
      '\t\t\t\t\t\t\tctx->rtsp.aeskey, ctx->rtsp.aesiv, ctx->rtsp.fmtp,',
      '\t\t\t\t\t\t\tcport, tport, ctx, event_cb, http_cb, stream_base,',
      '\t\t\t\t\t\t\tstream_range, ctx->http_length);',
    ].join('\n'),
  );
  writeFileSync(serverPath, server, 'utf8');
};

const copyRuntimeDlls = (openSslRoot) => {
  const packageRoot = dirname(require.resolve('@lox-audioserver/node-libraop/package.json'));
  const releaseDir = join(packageRoot, 'build', 'Release');
  const prebuildDir = join(packageRoot, 'prebuilds', 'win32-x64');
  mkdirSync(prebuildDir, { recursive: true });
  const releaseNode = join(releaseDir, 'raop_addon.node');
  if (existsSync(releaseNode)) {
    copyFileSync(releaseNode, join(prebuildDir, 'raop_addon.node.napi.node'));
    console.log('[build:airplay-raop] Prebuild: win32-x64/raop_addon.node.napi.node');
  }
  const runtimeDlls = [
    'libssl-3-x64.dll',
    'libcrypto-3-x64.dll',
    'pthreadVC3.dll',
  ];
  for (const dll of runtimeDlls) {
    const source = join(openSslRoot, 'bin', dll);
    if (existsSync(source)) {
      copyFileSync(source, join(releaseDir, dll));
      copyFileSync(source, join(prebuildDir, dll));
      console.log(`[build:airplay-raop] Runtime DLL: ${dll}`);
    }
  }
};

try {
  if (process.platform !== 'win32') {
    fail('This spike build script currently targets Windows only.');
    process.exit();
  }

  const visualStudio = findVisualStudio();
  if (!visualStudio) {
    fail('Visual Studio 2022 Build Tools with MSBuild were not found.', [
      'Install VS 2022 Build Tools with Desktop development with C++ and Windows SDK.',
    ]);
    process.exit();
  }

  const openSslRoot = findOpenSsl();
  if (!openSslRoot) {
    fail('OpenSSL x64 headers/libs were not found.', [
      'Install Win64 OpenSSL or vcpkg openssl:x64-windows.',
      'Set OPENSSL_ROOT_DIR to the folder that contains include\\openssl\\ssl.h and lib\\.',
      'The currently detected OpenSSL-Win32 runtime folder is not enough for native compilation.',
    ]);
    process.exit();
  }
  const gitBashBin = findGitBash();
  if (!gitBashBin) {
    fail('Git Bash was not found, but node-libraop needs bash to prepare vendored libraop sources.', [
      'Install Git for Windows or make bash.exe available on PATH before C:\\Windows\\system32\\bash.exe.',
    ]);
    process.exit();
  }
  const pythonPath = findPython();
  if (!pythonPath) {
    fail('Python was not found for the libraop preparation script.', [
      'Install Python 3 and make python.exe available on PATH.',
    ]);
    process.exit();
  }
  const pythonShimDir = createPython3Shim(pythonPath);

  try {
    require.resolve('@lox-audioserver/node-libraop/package.json');
  } catch {
    fail('@lox-audioserver/node-libraop is not installed in node_modules.', [
      'Run npm install --include=optional --ignore-scripts first, then rerun npm run build:airplay-raop.',
    ]);
    process.exit();
  }
  patchNodeLibraopWindowsBuild(openSslRoot);

  const env = {
    ...process.env,
    OPENSSL_ROOT_DIR: openSslRoot,
    npm_config_build_from_source: 'true',
    npm_config_openssl_root: openSslRoot,
    INCLUDE: [
      join(openSslRoot, 'include'),
      process.env.INCLUDE ?? '',
    ].filter(Boolean).join(';'),
    LIB: [
      join(openSslRoot, 'lib'),
      process.env.LIB ?? '',
    ].filter(Boolean).join(';'),
    PATH: [
      pythonShimDir,
      gitBashBin,
      dirname(visualStudio.msbuild),
      visualStudio.vcBin,
      join(openSslRoot, 'bin'),
      process.env.PATH ?? '',
    ].filter(Boolean).join(';'),
  };

  console.log(`[build:airplay-raop] Visual Studio: ${visualStudio.installationPath}`);
  if (visualStudio.vcBin) {
    console.log(`[build:airplay-raop] MSVC x64: ${visualStudio.vcBin}`);
  }
  console.log(`[build:airplay-raop] OpenSSL: ${openSslRoot}`);
  console.log(`[build:airplay-raop] Bash: ${join(gitBashBin, 'bash.exe')}`);
  console.log(`[build:airplay-raop] Python: ${pythonPath}`);
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', `${npmCommand} rebuild @lox-audioserver/node-libraop --build-from-source`], { env });
  } else {
    run(npmCommand, ['rebuild', '@lox-audioserver/node-libraop', '--build-from-source'], { env });
  }
  console.log('[build:airplay-raop] RAOP native module rebuilt.');
  copyRuntimeDlls(openSslRoot);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const details = [message];
  if (message.includes('EPERM') && message.includes('node-libraop') && message.includes('.dll')) {
    details.push('Close any running ECHO/Electron process that has loaded the AirPlay native DLLs, then rerun npm run build:airplay-raop.');
  }
  fail('Failed to build AirPlay RAOP native module.', details);
}
