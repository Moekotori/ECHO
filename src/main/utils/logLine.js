import { createRequire } from 'module'

const require = createRequire(import.meta.url)

let iconvLite = null
try {
  iconvLite = require('iconv-lite')
} catch {
  iconvLite = null
}

export function logLine(text) {
  const line = String(text || '')
  if (process.platform === 'win32' && iconvLite?.encode && process.stdout?.write) {
    try {
      process.stdout.write(iconvLite.encode(`${line}\n`, 'cp936'))
      return
    } catch {
      // Fall through to normal console output if legacy console encoding write fails.
    }
  }
  console.log(line)
}
