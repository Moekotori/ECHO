export type ReleaseFile = {
  name: string
  path: string
  bytes: number
  sha256: string
}

export type ReleasesContent = {
  version: string
  publishedAt: string
  files: ReleaseFile[]
}

export type ChangelogEntry = {
  version: string
  date: string
  items: string[]
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  return (await res.json()) as T
}

export async function loadReleases(): Promise<ReleasesContent> {
  return await fetchJson<ReleasesContent>('/content/releases.json')
}

export async function loadChangelog(): Promise<ChangelogEntry[]> {
  return await fetchJson<ChangelogEntry[]>('/content/changelog.json')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const digits = i === 0 ? 0 : i === 1 ? 0 : 1
  return `${n.toFixed(digits)} ${units[i]}`
}

