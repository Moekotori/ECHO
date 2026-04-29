import { spawnSync } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const PKG = join(ROOT, 'node_modules', '@lox-audioserver', 'node-libraop')

function fail(message) {
  console.error(`[build-airplay-raop] ${message}`)
  process.exit(1)
}

function readText(path) {
  return readFileSync(path, 'utf8')
}

function writeText(path, text) {
  writeFileSync(path, text, 'utf8')
}

function replaceOnce(path, from, to, label) {
  const text = readText(path)
  if (text.includes(to)) return
  if (!text.includes(from)) fail(`Could not patch ${label} in ${path}`)
  writeText(path, text.replace(from, to))
}

function insertAfter(path, anchor, insert, label) {
  const text = readText(path)
  if (text.includes(insert.trim())) return
  if (!text.includes(anchor)) fail(`Could not patch ${label} in ${path}`)
  writeText(path, text.replace(anchor, `${anchor}${insert}`))
}

function patchBindingGyp() {
  const path = join(PKG, 'binding.gyp')
  const gyp = JSON.parse(readText(path))
  const target = gyp.targets?.[0]
  if (!target) fail('binding.gyp has no target')

  target.actions = []
  for (const condition of target.conditions || []) {
    if (condition?.[0] === "OS=='win'") {
      const opts = condition[1]
      opts.libraries = (opts.libraries || []).filter((lib) => lib !== '-lssl' && lib !== '-lcrypto')
    }
  }

  writeText(path, `${JSON.stringify(gyp, null, 2)}\n`)
}

function patchWinCompatHeaders() {
  const pthread = String.raw`#pragma once

#ifdef _WIN32

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <errno.h>
#include <stdlib.h>
#include <time.h>

#ifndef ETIMEDOUT
#define ETIMEDOUT 10060
#endif

#ifndef PTHREAD_CREATE_DETACHED
#define PTHREAD_CREATE_DETACHED 1
#endif

typedef HANDLE pthread_t;
typedef CRITICAL_SECTION pthread_mutex_t;
typedef CONDITION_VARIABLE pthread_cond_t;
typedef struct pthread_attr_s {
  int detachstate;
} pthread_attr_t;

typedef struct pthread_start_s {
  void* (*fn)(void*);
  void* arg;
} pthread_start_t;

static DWORD WINAPI pthread_start_thunk(LPVOID data) {
  pthread_start_t* start = (pthread_start_t*) data;
  void* (*fn)(void*) = start->fn;
  void* arg = start->arg;
  free(start);
  fn(arg);
  return 0;
}

static int pthread_create(pthread_t* thread, const pthread_attr_t* attr, void* (*fn)(void*), void* arg) {
  pthread_start_t* start = (pthread_start_t*) malloc(sizeof(pthread_start_t));
  if (!start) return ENOMEM;
  start->fn = fn;
  start->arg = arg;
  HANDLE handle = CreateThread(NULL, 0, pthread_start_thunk, start, 0, NULL);
  if (!handle) {
    free(start);
    return (int) GetLastError();
  }
  if (attr && attr->detachstate == PTHREAD_CREATE_DETACHED) {
    CloseHandle(handle);
    handle = NULL;
  }
  if (thread) *thread = handle;
  return 0;
}

static int pthread_join(pthread_t thread, void** value_ptr) {
  (void) value_ptr;
  if (!thread) return 0;
  WaitForSingleObject(thread, INFINITE);
  CloseHandle(thread);
  return 0;
}

static int pthread_attr_init(pthread_attr_t* attr) {
  if (attr) attr->detachstate = 0;
  return 0;
}

static int pthread_attr_setdetachstate(pthread_attr_t* attr, int detachstate) {
  if (attr) attr->detachstate = detachstate;
  return 0;
}

static int pthread_attr_destroy(pthread_attr_t* attr) {
  (void) attr;
  return 0;
}

static int pthread_mutex_init(pthread_mutex_t* mutex, const void* attr) {
  (void) attr;
  InitializeCriticalSection(mutex);
  return 0;
}

static int pthread_mutex_destroy(pthread_mutex_t* mutex) {
  DeleteCriticalSection(mutex);
  return 0;
}

static int pthread_mutex_lock(pthread_mutex_t* mutex) {
  EnterCriticalSection(mutex);
  return 0;
}

static int pthread_mutex_trylock(pthread_mutex_t* mutex) {
  return TryEnterCriticalSection(mutex) ? 0 : EBUSY;
}

static int pthread_mutex_unlock(pthread_mutex_t* mutex) {
  LeaveCriticalSection(mutex);
  return 0;
}

static int pthread_cond_init(pthread_cond_t* cond, const void* attr) {
  (void) attr;
  InitializeConditionVariable(cond);
  return 0;
}

static int pthread_cond_destroy(pthread_cond_t* cond) {
  (void) cond;
  return 0;
}

static int pthread_cond_wait(pthread_cond_t* cond, pthread_mutex_t* mutex) {
  SleepConditionVariableCS(cond, mutex, INFINITE);
  return 0;
}

static int pthread_cond_timedwait(pthread_cond_t* cond, pthread_mutex_t* mutex, const struct timespec* abstime) {
  DWORD timeout = INFINITE;
  if (abstime) {
    FILETIME ft;
    ULARGE_INTEGER now;
    GetSystemTimeAsFileTime(&ft);
    now.LowPart = ft.dwLowDateTime;
    now.HighPart = ft.dwHighDateTime;
    unsigned long long nowNs = (now.QuadPart - 116444736000000000ULL) * 100ULL;
    unsigned long long targetNs = ((unsigned long long) abstime->tv_sec * 1000000000ULL) + (unsigned long long) abstime->tv_nsec;
    timeout = targetNs <= nowNs ? 0 : (DWORD) ((targetNs - nowNs + 999999ULL) / 1000000ULL);
  }
  return SleepConditionVariableCS(cond, mutex, timeout) ? 0 : ETIMEDOUT;
}

static int pthread_cond_broadcast(pthread_cond_t* cond) {
  WakeAllConditionVariable(cond);
  return 0;
}

#else
#include_next <pthread.h>
#endif
`

  const semaphore = String.raw`#pragma once

#ifdef _WIN32

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <errno.h>

typedef HANDLE sem_t;

static int sem_init(sem_t* sem, int pshared, unsigned int value) {
  (void) pshared;
  HANDLE handle = CreateSemaphoreA(NULL, (LONG) value, 0x7fffffff, NULL);
  if (!handle) return (int) GetLastError();
  *sem = handle;
  return 0;
}

static int sem_destroy(sem_t* sem) {
  if (sem && *sem) {
    CloseHandle(*sem);
    *sem = NULL;
  }
  return 0;
}

static int sem_post(sem_t* sem) {
  return ReleaseSemaphore(*sem, 1, NULL) ? 0 : (int) GetLastError();
}

static int sem_wait(sem_t* sem) {
  DWORD rc = WaitForSingleObject(*sem, INFINITE);
  return rc == WAIT_OBJECT_0 ? 0 : (int) GetLastError();
}

#else
#include_next <semaphore.h>
#endif
`

  writeText(join(PKG, 'native', 'pthread.h'), pthread)
  writeText(join(PKG, 'native', 'semaphore.h'), semaphore)
}

function patchCrossSsl() {
  const path = join(PKG, 'vendor', 'libraop', 'crosstools', 'src', 'cross_ssl.c')
  replaceOnce(
    path,
    '#define P(n, ...) P##n(__VA_ARGS__)\n#define V(n, ...) V##n(__VA_ARGS__)',
    '#define CAT(a, b) CAT_I(a, b)\n#define CAT_I(a, b) a##b\n#define P(n, ...) CAT(P, n)(__VA_ARGS__)\n#define V(n, ...) CAT(V, n)(__VA_ARGS__)',
    'MSVC variadic macro expansion'
  )
}

function patchRaopClient() {
  const path = join(PKG, 'vendor', 'libraop', 'src', 'raop_client.c')
  const anchor = `uint32_t raopcl_sample_rate(struct raopcl_s *p)
{
\tif (!p) return 0;
\treturn p->sample_rate;
}
}
`
  const insert = `
/*----------------------------------------------------------------------------*/
uint32_t raopcl_queued_frames(struct raopcl_s *p)
{
\tuint32_t queued = 0;
\tuint64_t now_ts;

\tif (!p) return 0;

\tpthread_mutex_lock(&p->mutex);
\tnow_ts = NTP2TS(raopcl_get_ntp(NULL), p->sample_rate);
\tif (p->head_ts > now_ts) queued = (uint32_t) (p->head_ts - now_ts);
\tpthread_mutex_unlock(&p->mutex);

\treturn queued;
}

/*----------------------------------------------------------------------------*/
uint32_t raopcl_queue_len(struct raopcl_s *p)
{
\tuint32_t queued;

\tif (!p || !p->chunk_len) return 0;
\tqueued = raopcl_queued_frames(p);
\treturn (queued + (uint32_t) p->chunk_len - 1) / (uint32_t) p->chunk_len;
}
`
  insertAfter(path, anchor, insert, 'missing sender queue helpers')
}

function patchReceiverPlatformInit() {
  const path = join(PKG, 'native', 'addon.cc')
  const anchor = `#endif
  Napi::Object opts = info[0].As<Napi::Object>();`
  const patched = `#endif
  EnsurePlatformInitialized(env);

  Napi::Object opts = info[0].As<Napi::Object>();`
  replaceOnce(path, anchor, patched, 'receiver platform initialization')
}

function patchReceiverPcmEvents() {
  const serverHeader = join(PKG, 'vendor', 'libraop', 'src', 'raop_server.h')
  replaceOnce(
    serverHeader,
    'typedef enum { RAOP_STREAM, RAOP_PLAY, RAOP_FLUSH, RAOP_PAUSE, RAOP_STOP, RAOP_VOLUME, RAOP_METADATA, RAOP_ARTWORK } raopsr_event_t ;',
    'typedef enum { RAOP_STREAM, RAOP_PLAY, RAOP_FLUSH, RAOP_PAUSE, RAOP_STOP, RAOP_VOLUME, RAOP_METADATA, RAOP_ARTWORK, RAOP_PCM_FRAME } raopsr_event_t ;',
    'receiver PCM event enum'
  )

  const streamerHeader = join(PKG, 'vendor', 'libraop', 'src', 'raop_streamer.h')
  insertAfter(
    streamerHeader,
    'typedef\tvoid (*raopst_cb_t)(void *owner, raopst_event_t event);\n',
    'typedef\tvoid (*raopst_pcm_cb_t)(void *owner, uint8_t *data, size_t len);\n',
    'streamer PCM callback typedef'
  )
  replaceOnce(
    streamerHeader,
    'void *owner, raopst_cb_t event_cb, raop_http_cb_t http_cb,\n\t\t\t\t\t\t\tunsigned short port_base, unsigned short port_range,',
    'void *owner, raopst_cb_t event_cb, raop_http_cb_t http_cb,\n\t\t\t\t\t\t\traopst_pcm_cb_t pcm_cb,\n\t\t\t\t\t\t\tunsigned short port_base, unsigned short port_range,',
    'streamer PCM callback signature'
  )

  const streamerSource = join(PKG, 'vendor', 'libraop', 'src', 'raop_streamer.c')
  insertAfter(
    streamerSource,
    '\traop_http_cb_t http_cb;\n',
    '\traopst_pcm_cb_t pcm_cb;\n',
    'streamer PCM callback field'
  )
  replaceOnce(
    streamerSource,
    'void *owner,\n\t\t\t\t\t\t\t\traopst_cb_t event_cb, raop_http_cb_t http_cb,\n\t\t\t\t\t\t\t\tunsigned short port_base, unsigned short port_range,',
    'void *owner,\n\t\t\t\t\t\t\t\traopst_cb_t event_cb, raop_http_cb_t http_cb,\n\t\t\t\t\t\t\t\traopst_pcm_cb_t pcm_cb,\n\t\t\t\t\t\t\t\tunsigned short port_base, unsigned short port_range,',
    'streamer PCM callback source signature'
  )
  insertAfter(
    streamerSource,
    '\tctx->http_cb = http_cb;\n',
    '\tctx->pcm_cb = pcm_cb;\n',
    'streamer PCM callback assignment'
  )
  insertAfter(
    streamerSource,
    '\t\tif (ctx->http_ready && (pcm = _buffer_get_frame(ctx, &bytes)) != NULL) {\n\t\t\tsize_t frames = bytes / 4;\n',
    '\t\t\tif (ctx->pcm_cb && bytes) ctx->pcm_cb(ctx->owner, (uint8_t*) pcm, bytes);\n',
    'streamer PCM frame dispatch'
  )

  const serverSource = join(PKG, 'vendor', 'libraop', 'src', 'raop_server.c')
  insertAfter(
    serverSource,
    'static void \thttp_cb(void *owner, struct key_data_s *headers, struct key_data_s *response);\n',
    'static void \tpcm_cb(void *owner, uint8_t *data, size_t len);\n',
    'server PCM callback forward declaration'
  )
  replaceOnce(
    serverSource,
    'cport, tport, ctx, event_cb, http_cb, ctx->ports.base,',
    'cport, tport, ctx, event_cb, http_cb, pcm_cb, ctx->ports.base,',
    'server passes PCM callback to streamer'
  )
  insertAfter(
    serverSource,
    'static void http_cb(void *owner, struct key_data_s *headers, struct key_data_s *response) {\n\t// just callback owner, don\'t do much\n\traopsr_t *ctx = (raopsr_t*) owner;\n\tif (ctx->http_cb) ctx->http_cb(ctx->owner, headers, response);\n}\n',
    '\n/*----------------------------------------------------------------------------*/\nstatic void pcm_cb(void *owner, uint8_t *data, size_t len) {\n\traopsr_t *ctx = (raopsr_t*) owner;\n\tif (ctx && ctx->raop_cb) ctx->raop_cb(ctx->owner, RAOP_PCM_FRAME, data, len);\n}\n',
    'server PCM event bridge'
  )

  const addon = join(PKG, 'native', 'addon.cc')
  replaceOnce(
    addon,
    '#ifdef RAOP_PCM\n    case RAOP_PCM: {',
    '    case RAOP_PCM_FRAME: {',
    'addon PCM event case'
  )
  replaceOnce(
    addon,
    '      break;\n    }\n#endif\n    default:',
    '      break;\n    }\n    default:',
    'addon PCM event macro removal'
  )
}

function patchPlatformDlopen() {
  const path = join(PKG, 'vendor', 'libraop', 'crosstools', 'src', 'platform.c')
  const from = `#if WIN
/*----------------------------------------------------------------------------*/
void* dlopen(const char* filename, int flag) {
\tSetLastError(0);
\treturn LoadLibraryA(filename);
}`
  const to = `#if WIN
#include <windows.h>
extern IMAGE_DOS_HEADER __ImageBase;

static void* dlopen_from_module_dir(const char* filename) {
\tchar module_path[MAX_PATH];
\tchar dll_path[MAX_PATH];
\tchar* slash;

\tif (!GetModuleFileNameA((HMODULE) &__ImageBase, module_path, sizeof(module_path))) return NULL;
\tslash = strrchr(module_path, '\\\\');
\tif (!slash) return NULL;
\t*slash = '\\0';
\tsnprintf(dll_path, sizeof(dll_path), "%s\\\\%s", module_path, filename);
\treturn LoadLibraryA(dll_path);
}

/*----------------------------------------------------------------------------*/
void* dlopen(const char* filename, int flag) {
\tvoid* handle = NULL;
\tSetLastError(0);
\thandle = dlopen_from_module_dir(filename);
\tif (handle) return handle;
\treturn LoadLibraryA(filename);
}`
  replaceOnce(path, from, to, 'Windows module-local OpenSSL loading')
}

function listDirs(root, depth = 2) {
  const out = []
  function walk(dir, level) {
    if (level < 0) return
    out.push(dir)
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      walk(join(dir, entry.name), level - 1)
    }
  }
  walk(root, depth)
  return out
}

function findOpenSslPair() {
  const roots = [
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft OneDrive'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'MySQL'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation'),
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'OpenSSL-Win32', 'bin'),
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'OpenSSL-Win32'),
    join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  ]
  const sslNames = ['libssl-3-x64.dll', 'libssl-3.dll', 'libssl-1_1-x64.dll', 'libssl-1_1.dll', 'libssl.dll']
  const cryptoNames = ['libcrypto-3-x64.dll', 'libcrypto-3.dll', 'libcrypto-1_1-x64.dll', 'libcrypto-1_1.dll', 'libcrypto.dll']
  const dirs = roots.flatMap((root) => listDirs(root, 3))

  for (const dir of dirs) {
    const ssl = sslNames.map((name) => join(dir, name)).find((path) => existsSync(path))
    const crypto = cryptoNames.map((name) => join(dir, name)).find((path) => existsSync(path))
    if (!ssl || !crypto) continue
    try {
      if (statSync(ssl).size < 200_000 || statSync(crypto).size < 1_000_000) continue
    } catch {
      continue
    }
    return { ssl, crypto }
  }
  return null
}

function copyOpenSslRuntimeDlls() {
  const pair = findOpenSslPair()
  if (!pair) {
    console.warn('[build-airplay-raop] OpenSSL runtime DLL pair was not found. AirPlay may fail until libssl/libcrypto DLLs are placed next to raop_addon.node.')
    return
  }
  const outDir = join(PKG, 'build', 'Release')
  mkdirSync(outDir, { recursive: true })
  const sslName = pair.ssl.split(/[\\/]/).pop()
  const cryptoName = pair.crypto.split(/[\\/]/).pop()
  copyFileSync(pair.ssl, join(outDir, sslName))
  copyFileSync(pair.crypto, join(outDir, cryptoName))
  console.log(`[build-airplay-raop] Copied OpenSSL runtime DLLs from ${pair.ssl.replace(/\\[^\\]+$/, '')}`)
}

if (process.platform !== 'win32') {
  fail('This helper is Windows-only. Use the package native build on other platforms.')
}

if (!existsSync(PKG)) {
  fail('Missing node_modules/@lox-audioserver/node-libraop. Run npm install first.')
}

patchBindingGyp()
patchWinCompatHeaders()
patchCrossSsl()
patchRaopClient()
patchReceiverPlatformInit()
patchReceiverPcmEvents()
patchPlatformDlopen()

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmArgs = ['exec', '--yes', '--package', 'node-gyp', '--', 'node-gyp', 'rebuild']
const result =
  process.platform === 'win32'
    ? spawnSync(`${npmCmd} ${npmArgs.join(' ')}`, { cwd: PKG, stdio: 'inherit', shell: true })
    : spawnSync(npmCmd, npmArgs, { cwd: PKG, stdio: 'inherit', shell: false })

if (result.error) fail(result.error.message)
if (result.status !== 0) process.exit(result.status || 1)
copyOpenSslRuntimeDlls()
console.log('[build-airplay-raop] Built @lox-audioserver/node-libraop for Windows.')
