/**
 * Build the echo-audio-host native binary from echo_out.cpp.
 *
 * Usage:  node scripts/build-audio-host.mjs
 *
 * On Windows this uses MSVC (cl.exe) via the VS Developer Command Prompt,
 * or falls back to gcc/g++ if available.  On macOS/Linux it uses the system
 * compiler.  The output goes to electron-app/build/echo-audio-host[.exe].
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'src', 'main', 'audio', 'engine', 'echo_out.cpp')
const ASIO_SRC = join(ROOT, 'src', 'main', 'audio', 'asio-sdk', 'common', 'asio.cpp')
const ASIO_DRIVERS_SRC = join(ROOT, 'src', 'main', 'audio', 'asio-sdk', 'host', 'asiodrivers.cpp')
const ASIO_LIST_SRC = join(ROOT, 'src', 'main', 'audio', 'asio-sdk', 'host', 'pc', 'asiolist.cpp')
const ASIO_INC = join(ROOT, 'src', 'main', 'audio', 'asio-sdk', 'common')
const ASIO_HOST_INC = join(ROOT, 'src', 'main', 'audio', 'asio-sdk', 'host')
const ASIO_HOST_PC_INC = join(ROOT, 'src', 'main', 'audio', 'asio-sdk', 'host', 'pc')
const VST_SRC = join(ROOT, 'src', 'main', 'audio', 'engine', 'vst_worker.cpp')
const OUT_DIR = join(ROOT, 'electron-app', 'build')
const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const EXE = isWin ? 'echo-audio-host.exe' : 'echo-audio-host'
const VST_EXE = isWin ? 'vst-worker.exe' : 'vst-worker'
const OUT = join(OUT_DIR, EXE)
const VST_OUT = join(OUT_DIR, VST_EXE)

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

let cmd
let vstCmd

if (isWin) {
  // Try MSVC first, fall back to g++
  try {
    execSync('where cl.exe', { stdio: 'ignore' })
    cmd = `cl.exe /nologo /std:c++14 /O2 /I"${ASIO_INC}" /I"${ASIO_HOST_INC}" /I"${ASIO_HOST_PC_INC}" /DMA_ENABLE_ASIO /Fe:"${OUT}" "${SRC}" "${ASIO_SRC}" "${ASIO_DRIVERS_SRC}" "${ASIO_LIST_SRC}" ole32.lib user32.lib winmm.lib propsys.lib uuid.lib /link /SUBSYSTEM:CONSOLE`
    vstCmd = `cl.exe /nologo /O2 /Fe:"${VST_OUT}" "${VST_SRC}" /link /SUBSYSTEM:CONSOLE`
  } catch {
    console.log('[build-audio-host] cl.exe not found, trying g++...')
    cmd = `g++ -std=c++14 -O2 -DMA_ENABLE_ASIO -I"${ASIO_INC}" -I"${ASIO_HOST_INC}" -I"${ASIO_HOST_PC_INC}" -o "${OUT}" "${SRC}" "${ASIO_SRC}" "${ASIO_DRIVERS_SRC}" "${ASIO_LIST_SRC}" -lole32 -luser32 -lwinmm -lpropsys -luuid -static`
    vstCmd = `g++ -O2 -o "${VST_OUT}" "${VST_SRC}" -static`
  }
} else if (isMac) {
  cmd = `clang++ -O2 -o "${OUT}" "${SRC}" -framework CoreAudio -framework AudioUnit -framework CoreFoundation -lpthread`
  vstCmd = `clang++ -O2 -o "${VST_OUT}" "${VST_SRC}" -lpthread`
} else {
  cmd = `g++ -O2 -o "${OUT}" "${SRC}" -lpthread -ldl -lm`
  vstCmd = `g++ -O2 -o "${VST_OUT}" "${VST_SRC}" -lpthread`
}

console.log(`[build-audio-host] Compiling: ${cmd}`)

try {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
  console.log(`[build-audio-host] Success: ${OUT}`)

  console.log(`[build-audio-host] Compiling VST Worker: ${vstCmd}`)
  execSync(vstCmd, { cwd: ROOT, stdio: 'inherit' })
  console.log(`[build-audio-host] Success: ${VST_OUT}`)
} catch (e) {
  console.error('[build-audio-host] Compilation failed.')
  process.exit(1)
}
