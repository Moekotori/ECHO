import fs from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'

const root = process.cwd()
const decoder = new TextDecoder('utf-8', { fatal: true })
const strictMojibakeGuard = process.env.STRICT_ENCODING_GUARD === '1'

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.txt',
  '.yaml',
  '.yml'
])

const SKIP_DIRS = new Set([
  '.git',
  '.vite',
  'build',
  'dist',
  'node_modules',
  'out',
  'release'
])

const ALLOW_MOJIBAKE_SCAN = new Set([
  // This file intentionally contains a small mojibake detector regex.
  'src/main/neteaseLyrics.js'
])

const MOJIBAKE_TOKENS = [
  '\uFFFD',
  '\u00C2',
  '\u00C3',
  '\u9225',
  '\u93C2',
  '\u934A',
  '\u6D93',
  '\u7B1B',
  '\u93C8',
  '\u7F01',
  '\u8DFA',
  '\u6428',
  '\u5BF0',
  '\u6E5F',
  '\u9422',
  '\u93B5',
  '\u93C6',
  '\u93BE',
  '\u62F7',
  '\u7EE0',
  '\u68E3',
  '\u5F5B',
  '\u95B5',
  '\u95AB',
  '\u95BB',
  '\u935B',
  '\u6FE1',
  '\u7A09',
  '\u9287',
  '\u9288',
  '\u9289',
  '\u4EF9',
  '\u4EE7',
  '\u5031',
  '\u5046',
  '\u5054',
  '\u5063',
  '\u5137',
  '\u599E',
  '\u941D'
]

const mojibakePattern = new RegExp(MOJIBAKE_TOKENS.join('|'))
const invalidUtf8 = []
const mojibakeHits = []

function normalizePath(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/')
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }

    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    checkFile(fullPath)
  }
}

function checkFile(filePath) {
  const rel = normalizePath(filePath)
  const buffer = fs.readFileSync(filePath)
  let text

  try {
    text = decoder.decode(buffer)
  } catch {
    invalidUtf8.push(rel)
    return
  }

  if (ALLOW_MOJIBAKE_SCAN.has(rel)) return

  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (mojibakePattern.test(line)) {
      mojibakeHits.push(`${rel}:${index + 1}: ${line.trim().slice(0, 160)}`)
    }
  })
}

walk(root)

if (invalidUtf8.length || (strictMojibakeGuard && mojibakeHits.length)) {
  console.error('Encoding guard failed.')

  if (invalidUtf8.length) {
    console.error('\nFiles are not valid UTF-8:')
    invalidUtf8.forEach((file) => console.error(`- ${file}`))
  }

  if (mojibakeHits.length) {
    console.error('\nPossible mojibake text:')
    mojibakeHits.forEach((hit) => console.error(`- ${hit}`))
  }

  process.exit(1)
}

if (mojibakeHits.length) {
  console.warn('Encoding guard passed with warnings.')
  console.warn('Possible mojibake text:')
  mojibakeHits.forEach((hit) => console.warn(`- ${hit}`))
  console.warn('\nSet STRICT_ENCODING_GUARD=1 to make mojibake warnings blocking.')
  process.exit(0)
}

console.log('Encoding guard passed.')
