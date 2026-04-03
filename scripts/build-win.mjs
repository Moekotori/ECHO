/**
 * Windows: run electron-builder after best-effort unlock of dist/win-unpacked.
 * If the folder cannot be deleted (EPERM), build to `release/` instead of failing.
 */
import { existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const winUnpacked = join(root, 'dist', 'win-unpacked')
const releaseWinUnpacked = join(root, 'release', 'win-unpacked')

function pad2(n) {
  return String(n).padStart(2, '0')
}

function stamp() {
  const d = new Date()
  // YYYYMMDD-HHMMSS
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function tryRemoveDir(dir) {
  if (!existsSync(dir)) return true
  try {
    rmSync(dir, { recursive: true, force: true })
    return !existsSync(dir)
  } catch {
    return false
  }
}

function tryRemoveDirCmd(dir) {
  if (!existsSync(dir)) return true
  try {
    execSync(`cmd /c rd /s /q "${dir}"`, { stdio: 'ignore', windowsHide: true })
    return !existsSync(dir)
  } catch {
    return false
  }
}

async function tryUnlockWinUnpacked(targetDir) {
  if (process.env.ECHO_SKIP_WIN_UNLOCK === '1') {
    console.log('[build-win] skip unlock (ECHO_SKIP_WIN_UNLOCK=1)')
    return existsSync(targetDir)
  }
  for (const im of ['ECHO.exe', 'echoes.exe']) {
    try {
      execSync(`taskkill /F /IM ${im} /T`, { stdio: 'ignore' })
      console.log(`[build-win] taskkill ${im}`)
    } catch {
      /* ignore */
    }
  }
  await sleep(600)
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!existsSync(targetDir)) return false
    if (tryRemoveDir(targetDir) || tryRemoveDirCmd(targetDir)) {
      console.log(`[build-win] removed ${targetDir}`)
      return false
    }
    await sleep(500)
  }
  return existsSync(targetDir)
}

async function main() {
  const cli = join(root, 'node_modules', 'electron-builder', 'cli.js')
  const runBuilder = (extraArgs) => {
    const code = spawnSync(process.execPath, [cli, '--win', ...extraArgs], {
      cwd: root,
      stdio: 'inherit',
      env: process.env
    }).status
    process.exit(code ?? 1)
  }

  if (process.platform !== 'win32') {
    runBuilder([])
    return
  }

  const distStillLocked = await tryUnlockWinUnpacked(winUnpacked)

  let outputDir = null
  if (distStillLocked) {
    console.warn(
      '[build-win] Cannot clear dist/win-unpacked (file in use). Building to ./release/ instead.\n' +
        '  Installers will appear under release/. You can delete dist/ later when nothing locks it.\n'
    )
    outputDir = 'release'
    const relStillThere = await tryUnlockWinUnpacked(releaseWinUnpacked)
    if (relStillThere) {
      // If release/ is also locked, build into a fresh, timestamped output directory.
      // This avoids hard-failing on Windows file locks (Explorer, AV, crashed process, etc.)
      const fallback = `release-${stamp()}`
      console.warn(
        `[build-win] Also cannot clear release/win-unpacked (file in use). Building to ./${fallback}/ instead.\n` +
          '  You can delete old output folders later when nothing locks them.\n'
      )
      outputDir = fallback
    }
  }

  if (outputDir) {
    runBuilder([`-c.directories.output=${outputDir}`])
  } else {
    runBuilder([])
  }
}

await main()
