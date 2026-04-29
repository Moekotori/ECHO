import dgram from 'dgram'
import os from 'os'
import crypto from 'crypto'

const SSDP_ADDRESS = '239.255.255.250'
const SSDP_PORT = 1900
const DISCOVERY_TARGETS = [
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:linn-co-uk:device:Source:1',
  'urn:av-openhome-org:device:MediaRenderer:1'
]

const VIRTUAL_IFACE_RE =
  /virtual|vmware|vbox|hyper-v|wsl|docker|tailscale|zerotier|vethernet|tap-windows|npcap|bluetooth|teredo|isatap|pseudo|hyperv|vmnet|virbr|br-/i

export function scoreLanCandidate(addr, name) {
  if (VIRTUAL_IFACE_RE.test(name || '')) return -1
  const parts = String(addr)
    .split('.')
    .map((x) => parseInt(x, 10))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return -1
  const [a, b] = parts
  let score = 0
  if (a === 192 && b === 168) score = 100
  else if (a === 10) score = 90
  else if (a === 172 && b >= 16 && b <= 31) score = 80
  else if (a === 169 && b === 254) score = 12
  else score = 40
  if (/wi-?fi|wlan|wireless|802\.11|ethernet|eth\d|en\d|lan|local/i.test(name || '')) score += 16
  return score
}

export function getBestLanIPv4() {
  const env = process.env.ECHOES_CAST_IP?.trim() || process.env.ECHOES_DLNA_IP?.trim()
  if (env && /^(\d{1,3}\.){3}\d{1,3}$/.test(env)) {
    const parts = env.split('.').map((x) => parseInt(x, 10))
    if (parts.every((n) => n >= 0 && n <= 255)) return env
  }
  const candidates = []
  const nets = os.networkInterfaces()
  for (const [name, entries] of Object.entries(nets)) {
    for (const net of entries || []) {
      if (net.family !== 'IPv4' || net.internal) continue
      const score = scoreLanCandidate(net.address, name)
      if (score >= 0) candidates.push({ address: net.address, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.address || '127.0.0.1'
}

function parseHeaders(raw) {
  const headers = {}
  for (const line of String(raw || '').split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key) headers[key] = value
  }
  return headers
}

function xmlText(xml, tag) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i')
  const match = String(xml || '').match(re)
  if (!match) return ''
  return decodeXml(match[1].replace(/<[^>]+>/g, '').trim())
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
}

function absolutizeUrl(value, base) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    return new URL(text, base).href
  } catch {
    return ''
  }
}

function parseServices(xml, descriptorUrl) {
  const services = []
  const serviceRe = /<service\b[^>]*>([\s\S]*?)<\/service>/gi
  let match = null
  while ((match = serviceRe.exec(xml))) {
    const block = match[1]
    const serviceType = xmlText(block, 'serviceType')
    const serviceId = xmlText(block, 'serviceId')
    const controlURL = absolutizeUrl(xmlText(block, 'controlURL'), descriptorUrl)
    const eventSubURL = absolutizeUrl(xmlText(block, 'eventSubURL'), descriptorUrl)
    const SCPDURL = absolutizeUrl(xmlText(block, 'SCPDURL'), descriptorUrl)
    if (!serviceType) continue
    services.push({ serviceType, serviceId, controlURL, eventSubURL, SCPDURL })
  }
  return services
}

function findService(services, needle) {
  const text = String(needle || '').toLowerCase()
  return services.find((service) => service.serviceType.toLowerCase().includes(text)) || null
}

function buildDeviceId(location, xml) {
  const udn = xmlText(xml, 'UDN')
  if (udn) return udn.replace(/^uuid:/i, '')
  return crypto.createHash('sha1').update(String(location || '')).digest('hex').slice(0, 16)
}

async function fetchDescriptor(location, timeoutMs = 3200) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(location, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ECHO/1.0 UPnP-ControlPoint' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

export async function parseDeviceFromLocation(location, responseHeaders = {}) {
  const descriptorUrl = String(location || '').trim()
  if (!/^https?:\/\//i.test(descriptorUrl)) return null
  const xml = await fetchDescriptor(descriptorUrl)
  const services = parseServices(xml, descriptorUrl)
  const avTransport = findService(services, 'AVTransport')
  const renderingControl = findService(services, 'RenderingControl')
  const connectionManager = findService(services, 'ConnectionManager')
  const openHomePlaylist = findService(services, 'av-openhome-org:service:Playlist')
  const friendlyName = xmlText(xml, 'friendlyName') || responseHeaders.server || descriptorUrl
  const manufacturer = xmlText(xml, 'manufacturer')
  const modelName = xmlText(xml, 'modelName')
  const deviceType = xmlText(xml, 'deviceType') || responseHeaders.st || ''
  return {
    id: buildDeviceId(descriptorUrl, xml),
    name: friendlyName,
    manufacturer,
    modelName,
    deviceType,
    location: descriptorUrl,
    host: new URL(descriptorUrl).host,
    supportsDlna: !!avTransport,
    supportsOpenHome: !!openHomePlaylist,
    services,
    avTransport,
    renderingControl,
    connectionManager,
    openHomePlaylist,
    lastSeenAt: Date.now()
  }
}

export async function discoverUpnpRenderers({ timeoutMs = 3600, logLine = null } = {}) {
  const responses = new Map()
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, () => {
      socket.removeListener('error', reject)
      resolve()
    })
  })

  socket.on('message', (msg) => {
    const headers = parseHeaders(msg.toString('utf8'))
    const location = headers.location
    if (location && !responses.has(location)) responses.set(location, headers)
  })

  const sendSearch = (st) => {
    const request = [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 2',
      `ST: ${st}`,
      '',
      ''
    ].join('\r\n')
    socket.send(Buffer.from(request), SSDP_PORT, SSDP_ADDRESS)
  }

  for (const st of DISCOVERY_TARGETS) {
    sendSearch(st)
    setTimeout(() => sendSearch(st), 280)
  }

  await new Promise((resolve) => setTimeout(resolve, timeoutMs))
  try {
    socket.close()
  } catch {
    /* ignore */
  }

  const devices = []
  for (const [location, headers] of responses.entries()) {
    try {
      const device = await parseDeviceFromLocation(location, headers)
      if (device && (device.supportsDlna || device.supportsOpenHome)) devices.push(device)
    } catch (error) {
      if (typeof logLine === 'function') {
        logLine(`Cast discovery descriptor failed: ${location} | ${error?.message || error}`)
      }
    }
  }

  const byId = new Map()
  for (const device of devices) {
    const existing = byId.get(device.id)
    if (!existing || (!existing.supportsOpenHome && device.supportsOpenHome)) byId.set(device.id, device)
  }
  return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))
}
