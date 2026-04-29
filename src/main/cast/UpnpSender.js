import { CastHttpServer } from './CastHttpServer.js'
import { discoverUpnpRenderers } from './UpnpDiscovery.js'

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function secondsToDuration(seconds) {
  const sec = Math.max(0, Number(seconds) || 0)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function buildDidl(track) {
  const title = escapeXml(track.title || 'Unknown Track')
  const artist = escapeXml(track.artist || 'Unknown Artist')
  const album = escapeXml(track.album || '')
  const streamUrl = escapeXml(track.streamUrl)
  const coverUrl = escapeXml(track.coverUrl || '')
  const duration = secondsToDuration(track.duration)
  const protocolInfo = escapeXml(track.protocolInfo || `http-get:*:${track.mime || '*'}:*`)
  const albumXml = album ? `<upnp:album>${album}</upnp:album>` : ''
  const coverXml = coverUrl
    ? `<upnp:albumArtURI dlna:profileID="JPEG_TN">${coverUrl}</upnp:albumArtURI>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
  xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">
  <item id="${escapeXml(track.id)}" parentID="0" restricted="1">
    <dc:title>${title}</dc:title>
    <dc:creator>${artist}</dc:creator>
    <upnp:artist>${artist}</upnp:artist>
    ${albumXml}
    ${coverXml}
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>
    <res protocolInfo="${protocolInfo}" duration="${duration}" size="${Number(track.size) || 0}">${streamUrl}</res>
  </item>
</DIDL-Lite>`
}

function soapEnvelope(body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>${body}</s:Body>
</s:Envelope>`
}

function xmlTag(name, value) {
  return `<${name}>${escapeXml(value)}</${name}>`
}

async function soapCall(service, action, body, timeoutMs = 5000) {
  if (!service?.controlURL || !service?.serviceType) throw new Error(`Missing UPnP service for ${action}`)
  const envelope = soapEnvelope(body)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(service.controlURL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${service.serviceType}#${action}"`,
        'User-Agent': 'ECHO/1.0 UPnP-ControlPoint'
      },
      body: envelope
    })
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      const fault = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1]
      throw new Error(`${action} failed: HTTP ${response.status}${fault ? ` ${fault}` : ''}`)
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

function normalizeVolume(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 50
  return Math.max(0, Math.min(100, Math.round(num > 1 ? num : num * 100)))
}

export class UpnpSender {
  constructor({ logLine = null } = {}) {
    this.logLine = typeof logLine === 'function' ? logLine : () => {}
    this.httpServer = new CastHttpServer({ logLine: this.logLine })
    this.devices = new Map()
    this.activeDeviceId = ''
    this.activeTrack = null
    this.state = 'IDLE'
    this.lastError = ''
    this.lastDiscoveryAt = 0
  }

  async discover(options = {}) {
    const devices = await discoverUpnpRenderers({
      timeoutMs: Number(options.timeoutMs) || 3600,
      logLine: this.logLine
    })
    this.devices.clear()
    for (const device of devices) this.devices.set(device.id, device)
    this.lastDiscoveryAt = Date.now()
    return { ok: true, devices: this.listDevices(), discoveredAt: this.lastDiscoveryAt }
  }

  listDevices() {
    return [...this.devices.values()].map((device) => ({
      id: device.id,
      name: device.name,
      manufacturer: device.manufacturer,
      modelName: device.modelName,
      host: device.host,
      location: device.location,
      supportsDlna: device.supportsDlna,
      supportsOpenHome: device.supportsOpenHome,
      isActive: device.id === this.activeDeviceId
    }))
  }

  getDevice(deviceId) {
    const id = String(deviceId || this.activeDeviceId || '')
    const device = this.devices.get(id)
    if (!device) throw new Error('Cast renderer not selected or no longer available')
    return device
  }

  async playTrack(deviceId, track, options = {}) {
    const device = this.getDevice(deviceId)
    if (!device.avTransport) throw new Error('Renderer does not expose DLNA AVTransport')
    const exposed = await this.httpServer.exposeTrack(track)
    const metadata = buildDidl(exposed)
    const setUriBody = `
<u:SetAVTransportURI xmlns:u="${device.avTransport.serviceType}">
  ${xmlTag('InstanceID', '0')}
  ${xmlTag('CurrentURI', exposed.streamUrl)}
  ${xmlTag('CurrentURIMetaData', metadata)}
</u:SetAVTransportURI>`
    await soapCall(device.avTransport, 'SetAVTransportURI', setUriBody, 6000)
    const playBody = `
<u:Play xmlns:u="${device.avTransport.serviceType}">
  ${xmlTag('InstanceID', '0')}
  ${xmlTag('Speed', '1')}
</u:Play>`
    await soapCall(device.avTransport, 'Play', playBody, 5000)
    this.activeDeviceId = device.id
    this.activeTrack = {
      id: exposed.id,
      title: exposed.title,
      artist: exposed.artist,
      album: exposed.album,
      streamUrl: exposed.streamUrl,
      coverUrl: exposed.coverUrl,
      mime: exposed.mime,
      bitPerfect: options.processed !== true
    }
    this.state = 'PLAYING'
    this.lastError = ''
    this.logLine(`[CastOut] ${exposed.title} -> ${device.name} (${exposed.mime})`)
    return { ok: true, status: this.getStatus() }
  }

  async pause(deviceId = '') {
    const device = this.getDevice(deviceId)
    const body = `<u:Pause xmlns:u="${device.avTransport.serviceType}">${xmlTag('InstanceID', '0')}</u:Pause>`
    await soapCall(device.avTransport, 'Pause', body, 4500)
    this.state = 'PAUSED'
    return { ok: true, status: this.getStatus() }
  }

  async resume(deviceId = '') {
    const device = this.getDevice(deviceId)
    const body = `<u:Play xmlns:u="${device.avTransport.serviceType}">${xmlTag('InstanceID', '0')}${xmlTag(
      'Speed',
      '1'
    )}</u:Play>`
    await soapCall(device.avTransport, 'Play', body, 4500)
    this.state = 'PLAYING'
    return { ok: true, status: this.getStatus() }
  }

  async stop(deviceId = '') {
    const device = this.getDevice(deviceId)
    const body = `<u:Stop xmlns:u="${device.avTransport.serviceType}">${xmlTag('InstanceID', '0')}</u:Stop>`
    await soapCall(device.avTransport, 'Stop', body, 4500)
    this.state = 'STOPPED'
    return { ok: true, status: this.getStatus() }
  }

  async seek(seconds, deviceId = '') {
    const device = this.getDevice(deviceId)
    const body = `<u:Seek xmlns:u="${device.avTransport.serviceType}">
  ${xmlTag('InstanceID', '0')}
  ${xmlTag('Unit', 'REL_TIME')}
  ${xmlTag('Target', secondsToDuration(seconds))}
</u:Seek>`
    await soapCall(device.avTransport, 'Seek', body, 4500)
    return { ok: true, status: this.getStatus() }
  }

  async setVolume(volume, deviceId = '') {
    const device = this.getDevice(deviceId)
    if (!device.renderingControl) throw new Error('Renderer does not expose RenderingControl')
    const body = `<u:SetVolume xmlns:u="${device.renderingControl.serviceType}">
  ${xmlTag('InstanceID', '0')}
  ${xmlTag('Channel', 'Master')}
  ${xmlTag('DesiredVolume', normalizeVolume(volume))}
</u:SetVolume>`
    await soapCall(device.renderingControl, 'SetVolume', body, 4500)
    return { ok: true, status: this.getStatus() }
  }

  async shutdown() {
    await this.httpServer.stop()
    this.activeDeviceId = ''
    this.activeTrack = null
    this.state = 'IDLE'
    return { ok: true }
  }

  getStatus() {
    return {
      ok: true,
      state: this.state,
      activeDeviceId: this.activeDeviceId,
      activeDevice: this.activeDeviceId ? this.listDevices().find((d) => d.id === this.activeDeviceId) : null,
      activeTrack: this.activeTrack,
      signalPath: this.activeTrack?.bitPerfect === false ? 'Processed' : 'Bit-Perfect',
      devices: this.listDevices(),
      http: this.httpServer.getStatus(),
      lastError: this.lastError,
      lastDiscoveryAt: this.lastDiscoveryAt
    }
  }

  async safeCall(fn) {
    try {
      return await fn()
    } catch (error) {
      this.lastError = error?.message || String(error)
      this.logLine(`[CastOut] ${this.lastError}`)
      return { ok: false, error: this.lastError, status: this.getStatus() }
    }
  }
}
