import { readFile, writeFile } from 'node:fs/promises'
import * as OpenCC from 'opencc-js'

const sourcePath = new URL('../src/renderer/src/locales/zh.json', import.meta.url)
const targetPath = new URL('../src/renderer/src/locales/zh-tw.json', import.meta.url)
const cnToTw = OpenCC.Converter({ from: 'cn', to: 'tw' })

function convertLocaleTree(value) {
  if (typeof value === 'string') return cnToTw(value)
  if (Array.isArray(value)) return value.map(convertLocaleTree)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convertLocaleTree(item)]))
  }
  return value
}

const source = JSON.parse(await readFile(sourcePath, 'utf8'))
const converted = convertLocaleTree(source)

await writeFile(targetPath, `${JSON.stringify(converted, null, 2)}\n`, 'utf8')
