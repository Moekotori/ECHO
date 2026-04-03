import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

function fail(msg) {
  console.error(`[validate-content] ${msg}`)
  process.exit(1)
}

function isSha256(s) {
  return typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s)
}

function loadJson(path) {
  const abs = resolve(path)
  const raw = readFileSync(abs, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (e) {
    fail(`Invalid JSON: ${path} (${e?.message || e})`)
  }
}

function sha256OfFile(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function main() {
  const releasesPath = 'public/content/releases.json'
  const changelogPath = 'public/content/changelog.json'

  const releases = loadJson(releasesPath)
  if (!releases || typeof releases !== 'object') fail(`${releasesPath} must be an object`)
  if (!releases.version) fail(`${releasesPath} missing version`)
  if (!releases.publishedAt) fail(`${releasesPath} missing publishedAt`)
  if (!Array.isArray(releases.files) || releases.files.length === 0) fail(`${releasesPath} files[] required`)

  for (const f of releases.files) {
    if (!f?.name || !f?.path) fail(`${releasesPath} each file needs name/path`)
    if (typeof f.bytes !== 'number') fail(`${releasesPath} each file needs bytes (number)`)
    // Allow placeholder during initial setup; production should be a real SHA256.
    if (!f.sha256 || f.sha256 === 'REPLACE_ME_WITH_SHA256') {
      console.warn(`[validate-content] WARN: ${releasesPath} file ${f.name} has placeholder sha256`)
      continue
    }
    if (!isSha256(f.sha256)) fail(`${releasesPath} file ${f.name} sha256 must be 64 hex chars`)
  }

  const changelog = loadJson(changelogPath)
  if (!Array.isArray(changelog)) fail(`${changelogPath} must be an array`)
  for (const e of changelog) {
    if (!e?.version || !e?.date || !Array.isArray(e?.items)) {
      fail(`${changelogPath} entries need version/date/items[]`)
    }
  }

  console.log('[validate-content] OK')
  console.log(`- releases version: ${releases.version}`)
  console.log(`- changelog entries: ${changelog.length}`)
}

main()

