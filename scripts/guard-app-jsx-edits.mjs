import { execFileSync } from 'node:child_process'

const APP_PATH = 'src/renderer/src/App.jsx'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function changedFiles(args) {
  try {
    return git(args)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

const changed = new Set([
  ...changedFiles(['diff', '--name-only', 'HEAD']),
  ...changedFiles(['diff', '--cached', '--name-only', 'HEAD'])
])

if (!changed.has(APP_PATH)) {
  console.log(`OK: ${APP_PATH} is unchanged.`)
  process.exit(0)
}

const strictGuard = process.env.STRICT_APP_JSX_GUARD === '1'

if (process.env.ALLOW_APP_JSX_EDIT === '1') {
  console.warn(`WARN: ${APP_PATH} changed with ALLOW_APP_JSX_EDIT=1.`)
  console.warn('Confirm the edit followed docs/APP_JSX_CHANGE_MAP.md and run npm run build.')
  process.exit(0)
}

const log = strictGuard ? console.error : console.warn

log(`${strictGuard ? 'BLOCKED' : 'WARN'}: ${APP_PATH} has local changes.`)
log('')
log('Before finishing an App.jsx edit:')
log('1. Read docs/APP_JSX_CHANGE_MAP.md.')
log('2. Move new feature logic into components/utils/config/main where possible.')
log('3. Keep App.jsx edits limited to routing, props, state wiring, or a contiguous JSX block.')
log('4. Run npm run build and smoke-test touched interactions.')

if (strictGuard) {
  console.error('')
  console.error('Use ALLOW_APP_JSX_EDIT=1 for an intentional one-off override.')
  process.exit(1)
}

console.warn('')
console.warn('Soft guard only: set STRICT_APP_JSX_GUARD=1 to make this check blocking.')
process.exit(0)
