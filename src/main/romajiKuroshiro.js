import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { app } from 'electron'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * CJS / electron-vite 打包后 default 可能嵌一层或整包即类，统一解析为构造函数。
 */
function pickConstructor(mod) {
  if (mod == null) return null
  if (typeof mod === 'function') return mod
  const d = mod.default
  if (typeof d === 'function') return d
  if (d != null && typeof d === 'object' && typeof d.default === 'function') {
    return d.default
  }
  return null
}

function loadKuroshiroClass() {
  const m = require('kuroshiro')
  let C = pickConstructor(m)
  if (typeof C === 'function') return C
  try {
    const corePath = join(dirname(require.resolve('kuroshiro/package.json')), 'lib', 'core.js')
    C = pickConstructor(require(corePath))
    if (typeof C === 'function') return C
  } catch (_) {
    /* ignore */
  }
  return null
}

function loadKuromojiAnalyzerClass() {
  const m = require('kuroshiro-analyzer-kuromoji')
  const C = pickConstructor(m)
  return typeof C === 'function' ? C : null
}

let kuroshiroInstance = null
let initPromise = null

function resolveKuromojiDictPath() {
  const hasDict = (dir) => existsSync(join(dir, 'base.dat'))

  if (app?.isPackaged) {
    const unpacked = join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'kuromoji',
      'dict'
    )
    if (hasDict(unpacked)) return unpacked
  }

  const cwdDict = join(process.cwd(), 'node_modules', 'kuromoji', 'dict')
  if (hasDict(cwdDict)) return cwdDict

  const relMain = join(__dirname, '..', '..', 'node_modules', 'kuromoji', 'dict')
  if (hasDict(relMain)) return relMain

  return cwdDict
}

async function ensureKuroshiro() {
  if (kuroshiroInstance) return kuroshiroInstance
  if (!initPromise) {
    initPromise = (async () => {
      const Kuroshiro = loadKuroshiroClass()
      const KuromojiAnalyzer = loadKuromojiAnalyzerClass()
      if (typeof Kuroshiro !== 'function') {
        throw new Error('Kuroshiro constructor not available')
      }
      if (typeof KuromojiAnalyzer !== 'function') {
        throw new Error('KuromojiAnalyzer constructor not available')
      }
      const dictPath = resolveKuromojiDictPath()
      const kuroshiro = new Kuroshiro()
      await kuroshiro.init(new KuromojiAnalyzer({ dictPath }))
      kuroshiroInstance = kuroshiro
      return kuroshiroInstance
    })().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise
}

/**
 * @param {string[]} texts
 * @returns {Promise<string[]>}
 */
export async function convertLinesToRomaji(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return []
  const ks = await ensureKuroshiro()
  const out = []
  for (const raw of texts) {
    const t = typeof raw === 'string' ? raw.trim() : ''
    if (!t || t === 'No lyrics found') {
      out.push('')
      continue
    }
    try {
      const r = await ks.convert(t, { to: 'romaji', mode: 'normal' })
      out.push((r || '').trim())
    } catch {
      out.push('')
    }
  }
  return out
}
