import axios from 'axios'
import { createHash } from 'crypto'
import { basename, dirname, extname } from 'path/posix'
import { XMLParser } from 'fast-xml-parser'

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.dsf',
  '.dff',
  '.opus',
  '.webm',
  '.wma',
  '.alac',
  '.aiff',
  '.m4b',
  '.caf'
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text'
})

function normalizeServerUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('WebDAV 地址不能为空')
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const url = new URL(withProtocol)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/+$/, '')
}

function normalizePath(value) {
  let path = String(value || '/').trim()
  if (!path) path = '/'
  if (!path.startsWith('/')) path = `/${path}`
  return path.replace(/\/+/g, '/')
}

function encodePath(path) {
  return normalizePath(path)
    .split('/')
    .map((segment, index) => (index === 0 ? '' : encodeURIComponent(segment)))
    .join('/')
}

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function firstProp(response) {
  const propstats = asArray(response?.propstat)
  const ok = propstats.find(item => String(item?.status || '').includes(' 200 '))
  return (ok || propstats[0] || {})?.prop || {}
}

function textValue(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return String(value['#text'] || '')
  return String(value)
}

function isCollection(prop) {
  const type = prop?.resourcetype
  if (!type) return false
  if (typeof type === 'object') return Object.prototype.hasOwnProperty.call(type, 'collection')
  return String(type).toLowerCase().includes('collection')
}

function isAudioPath(path) {
  return AUDIO_EXTENSIONS.has(extname(path).toLowerCase())
}

function stableId(value) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16)
}

export function createWebDavTrackPath(sourceId, itemPath) {
  return `webdav://${encodeURIComponent(sourceId)}/file/${encodeURIComponent(normalizePath(itemPath))}`
}

export function parseWebDavTrackPath(value) {
  const raw = String(value || '')
  const match = raw.match(/^webdav:\/\/([^/]+)\/file\/(.+)$/i)
  if (!match) return null
  return {
    sourceId: decodeURIComponent(match[1]),
    itemPath: normalizePath(decodeURIComponent(match[2]))
  }
}

export function isWebDavTrackPath(value) {
  return Boolean(parseWebDavTrackPath(value))
}

export function mapWebDavFile(source, file, client = null) {
  const itemPath = normalizePath(file?.path)
  const title = basename(itemPath, extname(itemPath)) || file?.name || 'Unknown Title'
  const folderName = basename(dirname(itemPath)) || source?.name || 'WebDAV'
  const sourceName = source?.name || 'WebDAV'
  const suffix = extname(itemPath).replace(/^\./, '').toUpperCase()
  return {
    path: createWebDavTrackPath(source?.id || '', itemPath),
    name: title,
    title,
    artist: folderName,
    album: sourceName,
    duration: 0,
    remote: true,
    remoteType: 'webdav',
    remoteSourceId: source?.id || '',
    remoteSourceName: sourceName,
    remoteActualPath: itemPath,
    remoteWebDavPath: itemPath,
    sizeBytes: Number(file?.size || 0),
    mtimeMs: Number(file?.mtimeMs || 0),
    info: {
      title,
      artist: folderName,
      album: sourceName,
      codec: suffix || undefined,
      source: sourceName,
      remoteType: 'webdav',
      streamUrl: undefined
    }
  }
}

export class WebDavClient {
  constructor({ serverUrl, username, password, timeout = 15000 }) {
    this.serverUrl = normalizeServerUrl(serverUrl)
    this.username = String(username || '').trim()
    this.password = String(password || '')
    this.timeout = timeout
    this.basePath = normalizePath(new URL(this.serverUrl).pathname)
  }

  authHeaders() {
    if (!this.username) return {}
    const token = Buffer.from(`${this.username}:${this.password}`).toString('base64')
    return { Authorization: `Basic ${token}` }
  }

  buildUrl(itemPath = '/') {
    const url = new URL(this.serverUrl)
    const base = url.pathname.replace(/\/+$/, '')
    const item = encodePath(itemPath).replace(/^\/+/, '')
    url.pathname = item ? `${base}/${item}` : base || '/'
    return url.toString()
  }

  hrefToPath(href) {
    const hrefUrl = new URL(String(href || ''), this.serverUrl)
    const basePath = new URL(this.serverUrl).pathname.replace(/\/+$/, '')
    let rel = hrefUrl.pathname
    if (basePath && rel.toLowerCase().startsWith(basePath.toLowerCase())) {
      rel = rel.slice(basePath.length)
    }
    try {
      rel = decodeURIComponent(rel)
    } catch {
      /* Keep original path if the server returned malformed escaping. */
    }
    return normalizePath(rel || '/')
  }

  async propfind(itemPath = '/', depth = 1) {
    const result = await axios.request({
      method: 'PROPFIND',
      url: this.buildUrl(itemPath),
      timeout: this.timeout,
      responseType: 'text',
      validateStatus: status => status >= 200 && status < 500,
      headers: {
        ...this.authHeaders(),
        Depth: String(depth),
        'Content-Type': 'application/xml; charset=utf-8'
      },
      data:
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/>' +
        '<d:getcontentlength/><d:getlastmodified/><d:getcontenttype/></d:prop></d:propfind>'
    })
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`WebDAV HTTP ${result.status}`)
    }
    const payload = parser.parse(result.data)
    return asArray(payload?.multistatus?.response)
  }

  async ping() {
    await this.list('/')
    return true
  }

  async list(itemPath = '/') {
    const root = normalizePath(itemPath)
    const responses = await this.propfind(root, 1)
    return responses
      .map(response => {
        const prop = firstProp(response)
        const path = this.hrefToPath(response?.href)
        if (!path || path === root) return null
        const collection = isCollection(prop)
        return {
          id: stableId(path),
          path,
          name: textValue(prop.displayname) || basename(path) || '/',
          isDirectory: collection,
          size: Number(textValue(prop.getcontentlength) || 0),
          mtimeMs: Date.parse(textValue(prop.getlastmodified)) || 0,
          contentType: textValue(prop.getcontenttype)
        }
      })
      .filter(Boolean)
  }

  async collectAudioFiles(rootPath = '/', options = {}) {
    const maxDepth = Number(options.maxDepth || 5)
    const maxFiles = Number(options.maxFiles || 500)
    const out = []
    const seen = new Set()

    const visit = async (path, depth) => {
      if (out.length >= maxFiles || depth > maxDepth || seen.has(path)) return
      seen.add(path)
      const entries = await this.list(path)
      for (const entry of entries) {
        if (out.length >= maxFiles) break
        if (entry.isDirectory) {
          await visit(entry.path, depth + 1)
        } else if (isAudioPath(entry.path)) {
          out.push(entry)
        }
      }
    }

    await visit(normalizePath(rootPath), 0)
    return out
  }

  async search(query, source) {
    const needle = String(query || '').trim().toLowerCase()
    const files = await this.collectAudioFiles('/', { maxDepth: 5, maxFiles: 500 })
    const songs = files
      .filter(file => {
        if (!needle) return true
        return [file.name, file.path].join('\n').toLowerCase().includes(needle)
      })
      .slice(0, 250)
      .map(file => mapWebDavFile(source, file, this))

    const albumMap = new Map()
    for (const track of songs) {
      const folderId = dirname(track.remoteWebDavPath || track.remoteActualPath || '/')
      if (!albumMap.has(folderId)) {
        albumMap.set(folderId, {
          id: folderId,
          name: basename(folderId) || source?.name || 'WebDAV',
          title: basename(folderId) || source?.name || 'WebDAV',
          artist: source?.name || 'WebDAV',
          songCount: 0,
          duration: 0
        })
      }
      albumMap.get(folderId).songCount += 1
    }

    return { artists: [], albums: Array.from(albumMap.values()), songs }
  }

  getFileUrl(itemPath) {
    const url = new URL(this.buildUrl(itemPath))
    if (this.username) {
      url.username = this.username
      url.password = this.password
    }
    return url.toString()
  }
}
