import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()

function fail(message) {
  console.error(`[verify:release] FAIL ${message}`)
  process.exitCode = 1
}

function pass(message) {
  console.log(`[verify:release] OK   ${message}`)
}

function warn(message) {
  console.warn(`[verify:release] WARN ${message}`)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function assertFileExists(relativePath) {
  const fullPath = path.join(rootDir, relativePath)
  if (!fs.existsSync(fullPath)) {
    fail(`missing file: ${relativePath}`)
    return null
  }
  pass(`found ${relativePath}`)
  return fullPath
}

const packageJsonPath = assertFileExists('package.json')
if (!packageJsonPath) process.exit(process.exitCode || 1)

const packageJson = readJson(packageJsonPath)
const publishConfig = packageJson?.build?.publish?.[0] || {}
const owner = publishConfig.owner || ''
const repo = publishConfig.repo || ''

if (packageJson?.scripts?.build) pass('package.json defines build script')
else fail('package.json is missing build script')

if (packageJson?.scripts?.['test:unit']) pass('package.json defines test:unit script')
else fail('package.json is missing test:unit script')

if (packageJson?.scripts?.['verify:release']) pass('package.json defines verify:release script')
else fail('package.json is missing verify:release script')

if (owner && repo) {
  pass(`publish target is configured for ${owner}/${repo}`)
} else {
  fail('build.publish github owner/repo is incomplete')
}

assertFileExists(packageJson?.build?.icon || 'website/icon.png')
assertFileExists('website/script.js')
assertFileExists('docs/SMOKE_AUDIO.md')
assertFileExists('docs/RELEASE_CHECKLIST.md')
assertFileExists('src/main/plugins/PluginManager.js')
assertFileExists('out/main/index.js')
assertFileExists('out/preload/index.js')
assertFileExists('out/renderer/index.html')

const websiteScript = fs.readFileSync(path.join(rootDir, 'website/script.js'), 'utf8')
if (/your-github-username|TODO:\s*replace/i.test(websiteScript)) {
  fail('website/script.js still contains placeholder repository values')
}
if (
  owner &&
  repo &&
  websiteScript.includes(`const owner = '${owner}'`) &&
  websiteScript.includes(`const repo = '${repo}'`)
) {
  pass('website/script.js release feed matches package publish config')
} else {
  fail('website/script.js does not match package build.publish owner/repo')
}

const releaseMetadataCandidates = ['release/latest.yml', 'dist/latest.yml']
const existingReleaseMetadata = releaseMetadataCandidates.find((candidate) =>
  fs.existsSync(path.join(rootDir, candidate))
)
if (existingReleaseMetadata) {
  pass(`found OTA metadata: ${existingReleaseMetadata}`)
} else {
  warn('no latest.yml found yet; run build:win:release before final OTA validation')
}

if (process.exitCode) {
  console.error('[verify:release] release verification failed')
  process.exit(process.exitCode)
}

console.log('[verify:release] release verification passed')
