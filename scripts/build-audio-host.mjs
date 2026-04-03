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
const OUT_DIR = join(ROOT, 'electron-app', 'build')
const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const EXE = isWin ? 'echo-audio-host.exe' : 'echo-audio-host'
const OUT = join(OUT_DIR, EXE)

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

let cmd

if (isWin) {
  // Try MSVC first, fall back to g++
  try {
    execSync('where cl.exe', { stdio: 'ignore' })
    cmd = `cl.exe /nologo /O2 /Fe:"${OUT}" "${SRC}" ole32.lib user32.lib winmm.lib /link /SUBSYSTEM:CONSOLE`
  } catch {
    console.log('[build-audio-host] cl.exe not found, trying g++...')
    cmd = `g++ -O2 -o "${OUT}" "${SRC}" -lole32 -luser32 -lwinmm -static`
  }
} else if (isMac) {
  cmd = `clang++ -O2 -o "${OUT}" "${SRC}" -framework CoreAudio -framework AudioUnit -framework CoreFoundation -lpthread`
} else {
  cmd = `g++ -O2 -o "${OUT}" "${SRC}" -lpthread -ldl -lm`
}

console.log(`[build-audio-host] Compiling: ${cmd}`)

try {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
  console.log(`[build-audio-host] Success: ${OUT}`)
} catch (e) {
  console.error('[build-audio-host] Compilation failed.')
  process.exit(1)
}
