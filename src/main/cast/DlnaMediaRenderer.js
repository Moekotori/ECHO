/**
 * 极简 UPnP AV MediaRenderer（DLNA），供手机端「投到本机」。
 * 依赖主进程 AudioEngine（FFmpeg → PortAudio）播放 SetAVTransportURI 给出的 HTTP(S) URL。
 */
import http from 'http'
import dgram from 'dgram'
import os from 'os'
import fs from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'

/** 虚拟网卡名（多网卡时若排到第一位会导致 LOCATION 不可达，网易云等搜不到设备） */
const VIRTUAL_IFACE_RE =
  /virtual|vmware|vbox|hyper-v|wsl|docker|tailscale|zerotier|vethernet|vEthernet|tap-windows|npcap|bluetooth|teredo|isatap|pseudo|netsupport|hyperv|vmnet|virbr|br-/i

function scoreLanCandidate(addr, name) {
  if (VIRTUAL_IFACE_RE.test(name)) return -1
  const parts = String(addr)
    .split('.')
    .map((x) => parseInt(x, 10))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return -1
  let s = 0
  const [a, b] = parts
  if (a === 192 && b === 168) s = 100
  else if (a === 10) s = 90
  else if (a === 172 && b >= 16 && b <= 31) s = 80
  else if (a === 169 && b === 254) s = 15
  else s = 45
  if (/wi-?fi|wlan|无线|802\.11|ethernet|eth\d|en\d|局域网|本地连接|乙太網路/i.test(name)) s += 18
  return s
}

/**
 * 选取最可能用于手机发现的本机 IPv4（非「第一个网卡」）。
 * 可通过环境变量强制指定：ECHOES_DLNA_IP=192.168.1.10
 */
function getBestLanIPv4() {
  const env = process.env.ECHOES_DLNA_IP?.trim()
  if (env && /^(\d{1,3}\.){3}\d{1,3}$/.test(env)) {
    const p = env.split('.').map((x) => parseInt(x, 10))
    if (p.length === 4 && p.every((n) => n >= 0 && n <= 255)) return env
  }
  const nets = os.networkInterfaces()
  const candidates = []
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue
      const score = scoreLanCandidate(net.address, name)
      if (score >= 0) candidates.push({ address: net.address, score })
    }
  }
  if (!candidates.length) return '127.0.0.1'
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].address
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function secToRelTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function parseSeekTarget(raw) {
  if (!raw || typeof raw !== 'string') return 0
  const t = raw.trim()
  const parts = t.split(/[:.]/).map((x) => parseInt(x, 10))
  if (parts.some((n) => Number.isNaN(n))) return 0
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

function decodeXmlTextEntities(s) {
  if (!s) return ''
  return String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/** 取首个匹配标签的文本（支持 dc:title、upnp:artist 等前缀） */
function firstDidlTagText(xml, localName) {
  if (!xml || !localName) return ''
  const re = new RegExp(
    `<(?:[a-zA-Z_][\\w.-]*:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z_][\\w.-]*:)?${localName}>`,
    'i'
  )
  const m = xml.match(re)
  if (!m) return ''
  let inner = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
  inner = inner.replace(/<[^>]+>/g, '').trim()
  return decodeXmlTextEntities(inner).trim()
}

/** DIDL 里 title/artist 可能在首行 item 属性、或仅出现一次的无前缀标签 */
function extractDidlTitleLoose(xml) {
  if (!xml) return ''
  let t = firstDidlTagText(xml, 'title')
  if (t) return t
  const m1 = xml.match(/<dc:title[^>]*>([^<]*)</i)
  if (m1?.[1]?.trim()) return decodeXmlTextEntities(m1[1].trim())
  const m2 = xml.match(/<item[^>]*\btitle="([^"]*)"/i)
  if (m2?.[1]?.trim()) return decodeXmlTextEntities(m2[1].trim())
  const m3 = xml.match(/<Item[^>]*\bTitle="([^"]*)"/i)
  if (m3?.[1]?.trim()) return decodeXmlTextEntities(m3[1].trim())
  return ''
}

function extractDidlArtistLoose(xml) {
  if (!xml) return ''
  let a =
    firstDidlTagText(xml, 'artist') ||
    firstDidlTagText(xml, 'creator') ||
    firstDidlTagText(xml, 'Author')
  if (a) return a
  const m1 = xml.match(/<(?:upnp:)?artist[^>]*>([^<]*)</i)
  if (m1?.[1]?.trim()) return decodeXmlTextEntities(m1[1].trim())
  const m2 = xml.match(/<dc:creator[^>]*>([^<]*)</i)
  if (m2?.[1]?.trim()) return decodeXmlTextEntities(m2[1].trim())
  return ''
}

function extractDidlAlbumLoose(xml) {
  if (!xml) return ''
  let a = firstDidlTagText(xml, 'album')
  if (a) return a
  const m = xml.match(/<upnp:album[^>]*>([^<]*)</i)
  if (m?.[1]?.trim()) return decodeXmlTextEntities(m[1].trim())
  return ''
}

/** UPnP / DIDL 常见 duration="0:03:45.000" 或 res 上的 duration */
function parseUpnpTimeToSec(t) {
  if (!t || typeof t !== 'string') return 0
  const s = t.trim()
  const parts = s.split(/[:.]/).map((x) => parseFloat(x))
  if (parts.some((n) => Number.isNaN(n))) return 0
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)
}

function extractDidlDurationSec(xml) {
  if (!xml) return 0
  const m =
    xml.match(/<res[^>]*\bduration\s*=\s*"([^"]+)"/i) || xml.match(/\bduration\s*=\s*"([^"]+)"/i)
  if (!m?.[1]) return 0
  const sec = parseUpnpTimeToSec(m[1])
  return Number.isFinite(sec) && sec > 0 ? sec : 0
}

/** 网易云 CDN 路径里常含纯数字歌曲 id（比 MD5 文件名更有展示意义） */
function extractNeteaseSongIdFromPath(uri) {
  if (!uri || typeof uri !== 'string') return ''
  try {
    const path = new URL(uri).pathname
    const nums = path.match(/\d{6,}/g)
    if (!nums?.length) return ''
    nums.sort((a, b) => b.length - a.length)
    return nums[0]
  } catch (_) {
    return ''
  }
}

/** 从 URL 猜标题：去掉明显为哈希/随机文件名的段 */
function titleGuessFromStreamUrl(uri) {
  if (!uri || typeof uri !== 'string') return ''
  const sid = extractNeteaseSongIdFromPath(uri)
  if (sid) return `网易云音乐 · ID ${sid}`
  try {
    const u = new URL(uri)
    const host = (u.hostname || '').toLowerCase()
    if (/126\.net|music\.163/i.test(host)) return '网易云音乐'
  } catch (_) {}
  return '网络流媒体'
}

function isGarbageOrHashTitle(s) {
  if (!s || typeof s !== 'string') return true
  const t = s.trim()
  if (t.length < 8) return false
  if (/^[a-f0-9]{24,64}$/i.test(t)) return true
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-/i.test(t)) return true
  return false
}

function resolveAlbumArtUrl(raw, streamUri) {
  if (!raw || typeof raw !== 'string') return ''
  let u = raw.replace(/&amp;/gi, '&').trim()
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('//')) return 'https:' + u
  try {
    const base = new URL(streamUri)
    if (u.startsWith('/')) return base.origin + u
  } catch (_) {}
  return ''
}

/**
 * 标题/艺人来自 DIDL 或 URL 启发式；过滤 MD5 文件名；补全封面绝对地址
 */
function refineDlnaMeta(meta, streamUri, didlXml) {
  const out = {
    title: (meta.title || '').trim(),
    artist: (meta.artist || '').trim(),
    album: (meta.album || '').trim(),
    albumArtUrl: (meta.albumArtUrl || '').trim()
  }
  out.albumArtUrl = resolveAlbumArtUrl(out.albumArtUrl, streamUri)

  if (!out.title && streamUri) {
    out.title = titleGuessFromStreamUrl(streamUri)
  } else if (isGarbageOrHashTitle(out.title)) {
    out.title = titleGuessFromStreamUrl(streamUri)
  }

  if (!out.artist && /126\.net|music\.163/i.test(streamUri || '')) {
    out.artist = '网易云音乐'
  }

  if (!out.artist) {
    out.artist = '网络媒体'
  }

  const durationHintSec = extractDidlDurationSec(didlXml || '')
  return { meta: out, durationHintSec }
}

function extractDidlAlbumArtUrl(xml) {
  if (!xml) return ''
  let u = firstDidlTagText(xml, 'albumArtURI')
  if (!u) {
    const m = xml.match(/<res[^>]*protocolInfo="[^"]*image[^"]*"[^>]*>([^<]+)<\/res>/i)
    if (m) u = decodeXmlTextEntities(m[1].trim())
  }
  u = u.replace(/&amp;/gi, '&').trim()
  return /^https?:\/\//i.test(u) ? u : ''
}

const DIDL_MAX = 384 * 1024

/**
 * 从 SetAVTransportURI 的 CurrentURIMetaData（DIDL-Lite）解析展示用元数据
 */
function parseDidlLiteMetadata(didlXml) {
  const empty = { title: '', artist: '', album: '', albumArtUrl: '' }
  if (!didlXml || typeof didlXml !== 'string') return { ...empty }
  let xml = didlXml.trim()
  if (xml.length > DIDL_MAX) xml = xml.slice(0, DIDL_MAX)
  if (xml.includes('<![CDATA[')) {
    const cm = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i)
    if (cm) xml = cm[1].trim()
  }
  const title = extractDidlTitleLoose(xml)
  const artist = extractDidlArtistLoose(xml)
  const album = extractDidlAlbumLoose(xml)
  const albumArtUrl = extractDidlAlbumArtUrl(xml)
  return { title, artist, album, albumArtUrl }
}

function wrapDidlForSoapCdata(raw) {
  if (!raw || !String(raw).trim()) return ''
  const safe = String(raw).replace(/\]\]>/g, ']] >')
  return `<![CDATA[${safe}]]>`
}

/** 解析 SOAP：支持 u:CurrentURI、CurrentURI 及 CDATA（网易云等客户端常用） */
function extractSoapValue(body, localName) {
  if (!body || !localName) return ''
  const cdata = new RegExp(
    `<(?:[a-zA-Z_][\\w.-]*:)?${localName}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</`,
    'i'
  )
  const m1 = body.match(cdata)
  if (m1) return m1[1].trim()
  const re = new RegExp(
    `<(?:[a-zA-Z_][\\w.-]*:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z_][\\w.-]*:)?${localName}>`,
    'i'
  )
  const m2 = body.match(re)
  return m2 ? m2[1].trim() : ''
}

function getOrCreateDeviceUuid() {
  const dir = app.getPath('userData')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (_) {}
  const p = join(dir, 'echoes-dlna-device.uuid')
  try {
    if (fs.existsSync(p)) {
      const u = fs.readFileSync(p, 'utf8').trim()
      if (/^[0-9a-f-]{36}$/i.test(u)) return u
    }
  } catch (_) {}
  const u = randomUUID()
  try {
    fs.writeFileSync(p, u, 'utf8')
  } catch (_) {}
  return u
}

function soapEnvelope(inner) {
  return `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>${inner}</s:Body>
</s:Envelope>`
}

const SCPD_CONNECTION_MANAGER = `<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
<specVersion><major>1</major><minor>0</minor></specVersion>
<actionList>
  <action>
    <name>GetProtocolInfo</name>
    <argumentList>
      <argument><name>Source</name><direction>out</direction><relatedStateVariable>SourceProtocolInfo</relatedStateVariable></argument>
      <argument><name>Sink</name><direction>out</direction><relatedStateVariable>SinkProtocolInfo</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action>
    <name>GetCurrentConnectionIDs</name>
    <argumentList>
      <argument><name>ConnectionIDs</name><direction>out</direction><relatedStateVariable>CurrentConnectionIDs</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action>
    <name>PrepareForConnection</name>
    <argumentList>
      <argument><name>RemoteProtocolInfo</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_ConnectionManager</relatedStateVariable></argument>
      <argument><name>PeerConnectionManager</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_ConnectionManager</relatedStateVariable></argument>
      <argument><name>PeerConnectionID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_ConnectionID</relatedStateVariable></argument>
      <argument><name>Direction</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Direction</relatedStateVariable></argument>
      <argument><name>ConnectionID</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_ConnectionID</relatedStateVariable></argument>
      <argument><name>AVTransportID</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_AVTransportID</relatedStateVariable></argument>
      <argument><name>RcsID</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_RcsID</relatedStateVariable></argument>
    </argumentList>
  </action>
</actionList>
<serviceStateTable>
  <stateVariable sendEvents="no"><name>SourceProtocolInfo</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>SinkProtocolInfo</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentConnectionIDs</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_ConnectionManager</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_ConnectionID</name><dataType>i4</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_Direction</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_AVTransportID</name><dataType>i4</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_RcsID</name><dataType>i4</dataType></stateVariable>
</serviceStateTable>
</scpd>`

const SCPD_RENDERING_CONTROL = `<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
<specVersion><major>1</major><minor>0</minor></specVersion>
<actionList>
  <action>
    <name>ListPresets</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>CurrentPresetNameList</name><direction>out</direction><relatedStateVariable>CurrentPresetNameList</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action>
    <name>GetVolume</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>Channel</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Channel</relatedStateVariable></argument>
      <argument><name>CurrentVolume</name><direction>out</direction><relatedStateVariable>Volume</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action>
    <name>SetVolume</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>Channel</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Channel</relatedStateVariable></argument>
      <argument><name>DesiredVolume</name><direction>in</direction><relatedStateVariable>Volume</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action>
    <name>GetMute</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>Channel</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Channel</relatedStateVariable></argument>
      <argument><name>CurrentMute</name><direction>out</direction><relatedStateVariable>Mute</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action>
    <name>SetMute</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>Channel</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Channel</relatedStateVariable></argument>
      <argument><name>DesiredMute</name><direction>in</direction><relatedStateVariable>Mute</relatedStateVariable></argument>
    </argumentList>
  </action>
</actionList>
<serviceStateTable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_InstanceID</name><dataType>ui4</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_Channel</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentPresetNameList</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="yes"><name>Volume</name><dataType>ui2</dataType></stateVariable>
  <stateVariable sendEvents="yes"><name>Mute</name><dataType>boolean</dataType></stateVariable>
</serviceStateTable>
</scpd>`

const SCPD_AV_TRANSPORT = `<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
<specVersion><major>1</major><minor>0</minor></specVersion>
<actionList>
  <action><name>SetAVTransportURI</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>CurrentURI</name><direction>in</direction><relatedStateVariable>AVTransportURI</relatedStateVariable></argument>
      <argument><name>CurrentURIMetaData</name><direction>in</direction><relatedStateVariable>AVTransportURIMetaData</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>GetTransportInfo</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>CurrentTransportState</name><direction>out</direction><relatedStateVariable>TransportState</relatedStateVariable></argument>
      <argument><name>CurrentTransportStatus</name><direction>out</direction><relatedStateVariable>TransportStatus</relatedStateVariable></argument>
      <argument><name>CurrentSpeed</name><direction>out</direction><relatedStateVariable>TransportPlaySpeed</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>GetPositionInfo</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>Track</name><direction>out</direction><relatedStateVariable>CurrentTrack</relatedStateVariable></argument>
      <argument><name>TrackDuration</name><direction>out</direction><relatedStateVariable>CurrentTrackDuration</relatedStateVariable></argument>
      <argument><name>TrackMetaData</name><direction>out</direction><relatedStateVariable>CurrentTrackMetaData</relatedStateVariable></argument>
      <argument><name>TrackURI</name><direction>out</direction><relatedStateVariable>CurrentTrackURI</relatedStateVariable></argument>
      <argument><name>RelTime</name><direction>out</direction><relatedStateVariable>RelativeTimePosition</relatedStateVariable></argument>
      <argument><name>AbsTime</name><direction>out</direction><relatedStateVariable>AbsoluteTimePosition</relatedStateVariable></argument>
      <argument><name>RelCount</name><direction>out</direction><relatedStateVariable>RelativeCounterPosition</relatedStateVariable></argument>
      <argument><name>AbsCount</name><direction>out</direction><relatedStateVariable>AbsoluteCounterPosition</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>Play</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>Speed</name><direction>in</direction><relatedStateVariable>TransportPlaySpeed</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>Pause</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>Stop</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>Seek</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>Unit</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_SeekMode</relatedStateVariable></argument>
      <argument><name>Target</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_SeekTarget</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>GetMediaInfo</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>NrTracks</name><direction>out</direction><relatedStateVariable>NumberOfTracks</relatedStateVariable></argument>
      <argument><name>MediaDuration</name><direction>out</direction><relatedStateVariable>CurrentMediaDuration</relatedStateVariable></argument>
      <argument><name>CurrentURI</name><direction>out</direction><relatedStateVariable>AVTransportURI</relatedStateVariable></argument>
      <argument><name>CurrentURIMetaData</name><direction>out</direction><relatedStateVariable>AVTransportURIMetaData</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>GetTransportSettings</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>PlayMode</name><direction>out</direction><relatedStateVariable>CurrentPlayMode</relatedStateVariable></argument>
      <argument><name>RecQualityMode</name><direction>out</direction><relatedStateVariable>CurrentRecordQualityMode</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>GetDeviceCapabilities</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>PlayMedia</name><direction>out</direction><relatedStateVariable>PossiblePlaybackMedia</relatedStateVariable></argument>
      <argument><name>RecMedia</name><direction>out</direction><relatedStateVariable>PossibleRecordMedia</relatedStateVariable></argument>
      <argument><name>RecQualityModes</name><direction>out</direction><relatedStateVariable>PossibleRecordQualityModes</relatedStateVariable></argument>
    </argumentList>
  </action>
  <action><name>GetCurrentTransportActions</name>
    <argumentList>
      <argument><name>InstanceID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>
      <argument><name>Actions</name><direction>out</direction><relatedStateVariable>CurrentTransportActions</relatedStateVariable></argument>
    </argumentList>
  </action>
</actionList>
<serviceStateTable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_InstanceID</name><dataType>ui4</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>TransportState</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>TransportStatus</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>TransportPlaySpeed</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>AVTransportURI</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>AVTransportURIMetaData</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentTrack</name><dataType>i4</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentTrackDuration</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentTrackMetaData</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentTrackURI</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>RelativeTimePosition</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>AbsoluteTimePosition</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>RelativeCounterPosition</name><dataType>i4</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>AbsoluteCounterPosition</name><dataType>i4</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_SeekMode</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>A_ARG_TYPE_SeekTarget</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>NumberOfTracks</name><dataType>ui4</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentMediaDuration</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentPlayMode</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentRecordQualityMode</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>PossiblePlaybackMedia</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>PossibleRecordMedia</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>PossibleRecordQualityModes</name><dataType>string</dataType></stateVariable>
  <stateVariable sendEvents="no"><name>CurrentTransportActions</name><dataType>string</dataType></stateVariable>
</serviceStateTable>
</scpd>`

export class DlnaMediaRenderer {
  constructor({ audioEngine, getMainWindow, beforePlayHook, onCastActivity }) {
    this.audioEngine = audioEngine
    this.getMainWindow = getMainWindow
    this.beforePlayHook = beforePlayHook
    this.onCastActivity = onCastActivity
    this.httpServer = null
    this.httpPort = 0
    this.ssdpSocket = null
    this.notifyTimer = null
    this.statusTimer = null
    this.running = false
    this.friendlyName = 'ECHO'
    this.deviceUuid = null
    this.udn = null
    this.baseUrl = ''
    this.transportState = 'STOPPED'
    this.currentUri = ''
    this.trackDurationSec = 0
    this.lastError = null
    /** @type {string} 启动 DLNA 时选定的 LAN IP（用于 LOCATION / SSDP） */
    this.lanIp = ''
    /** 手机下发的 DIDL 原文（回写 GetMediaInfo 等） */
    this.currentDidlXml = ''
    /** @type {{ title: string, artist: string, album: string, albumArtUrl: string }} */
    this.dlnaMeta = {
      title: '',
      artist: '',
      album: '',
      albumArtUrl: ''
    }
  }

  _broadcastStatus() {
    if (this.onCastActivity) {
      this.onCastActivity()
      return
    }
    const win = this.getMainWindow?.()
    if (!win || win.isDestroyed()) return
    win.webContents.send('cast:status', this.getStatus())
  }

  _notifyPauseLocal() {
    const win = this.getMainWindow?.()
    if (!win || win.isDestroyed()) return
    win.webContents.send('cast:pause-local')
  }

  getStatus() {
    const st = this.audioEngine.getStatus()
    return {
      dlnaEnabled: this.running,
      dlnaName: this.friendlyName,
      dlnaPort: this.httpPort,
      dlnaLanIp: this.running ? this.lanIp : getBestLanIPv4(),
      transportState: this.transportState,
      currentUri: this.currentUri,
      trackDurationSec: this.trackDurationSec,
      positionSec: st.currentTime || 0,
      isPlaying: st.isPlaying,
      lastError: this.lastError,
      dlnaMeta: { ...this.dlnaMeta }
    }
  }

  /** 仅停止解码与输出，不关闭 DLNA HTTP/SSDP */
  async stopPlaybackOnly() {
    await this.audioEngine.stop()
    if (this.transportState === 'PLAYING' || this.transportState === 'PAUSED_PLAYBACK') {
      this.transportState = 'STOPPED'
    }
  }

  async _probeDuration(uri) {
    if (/^https?:\/\//i.test(uri)) uri = uri.replace(/&amp;/gi, '&')
    try {
      const ffmpeg = (await import('fluent-ffmpeg')).default
      const { getResolvedFfmpegStaticPath } = await import('../utils/resolveFfmpegStaticPath.js')
      ffmpeg.setFfmpegPath(getResolvedFfmpegStaticPath())
      let probeOpts = []
      if (/music\.163\.com|126\.net|netease|interface\.music\.163/i.test(uri)) {
        probeOpts = [
          '-analyzeduration',
          '10000000',
          '-probesize',
          '10000000',
          '-user_agent',
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 NeteaseMusic/9.0.0',
          '-headers',
          'Referer: https://music.163.com/\r\nOrigin: https://music.163.com\r\n'
        ]
      }
      const dur = await new Promise((resolve) => {
        const cb = (err, md) => {
          if (err || !md?.format?.duration) return resolve(0)
          resolve(md.format.duration)
        }
        if (probeOpts.length) ffmpeg.ffprobe(uri, probeOpts, cb)
        else ffmpeg.ffprobe(uri, cb)
      })
      if (Number.isFinite(dur) && dur > 0) return dur
    } catch (_) {}
    return 0
  }

  async start({ friendlyName } = {}) {
    if (this.running) await this.stop()
    this.lastError = null
    this.deviceUuid = getOrCreateDeviceUuid()
    this.udn = `uuid:${this.deviceUuid}`
    if (friendlyName && String(friendlyName).trim())
      this.friendlyName = String(friendlyName).trim().slice(0, 64)

    this.lanIp = getBestLanIPv4()

    await new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => this._onHttp(req, res))
      this.httpServer.on('error', reject)
      this.httpServer.listen(0, '0.0.0.0', () => {
        const addr = this.httpServer.address()
        this.httpPort = addr.port
        this.baseUrl = `http://${this.lanIp}:${this.httpPort}`
        resolve()
      })
    })

    try {
      this.ssdpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      await new Promise((resolve, reject) => {
        this.ssdpSocket.once('error', reject)
        this.ssdpSocket.bind(1900, '0.0.0.0', () => {
          try {
            if (this.lanIp && this.lanIp !== '127.0.0.1') {
              this.ssdpSocket.addMembership('239.255.255.250', this.lanIp)
              try {
                this.ssdpSocket.setMulticastInterface(this.lanIp)
              } catch (e) {
                console.warn('[DLNA] setMulticastInterface:', e.message)
              }
            } else {
              this.ssdpSocket.addMembership('239.255.255.250')
            }
          } catch (e) {
            try {
              this.ssdpSocket.addMembership('239.255.255.250')
            } catch (e2) {
              console.warn('[DLNA] addMembership:', e2.message)
            }
          }
          resolve()
        })
      })
      this.ssdpSocket.on('message', (msg, rinfo) => this._onSsdpMessage(msg, rinfo))
    } catch (e) {
      this.lastError = `SSDP 绑定失败（端口 1900）：${e.message}`
      console.error('[DLNA]', this.lastError)
      await this._closeHttpOnly()
      return { ok: false, error: this.lastError }
    }

    this.running = true
    this._sendNotify('ssdp:alive')
    this.notifyTimer = setInterval(() => this._sendNotify('ssdp:alive'), 25 * 1000)
    this.statusTimer = setInterval(() => this._broadcastStatus(), 1000)

    return {
      ok: true,
      port: this.httpPort,
      lanIp: this.lanIp,
      friendlyName: this.friendlyName
    }
  }

  async _closeHttpOnly() {
    if (this.httpServer) {
      await new Promise((r) => this.httpServer.close(() => r()))
      this.httpServer = null
    }
    this.httpPort = 0
  }

  async stop() {
    if (this.notifyTimer) {
      clearInterval(this.notifyTimer)
      this.notifyTimer = null
    }
    if (this.statusTimer) {
      clearInterval(this.statusTimer)
      this.statusTimer = null
    }
    if (this.ssdpSocket) {
      try {
        this._sendNotify('ssdp:byebye')
      } catch (_) {}
      try {
        if (this.lanIp && this.lanIp !== '127.0.0.1') {
          this.ssdpSocket.dropMembership('239.255.255.250', this.lanIp)
        } else {
          this.ssdpSocket.dropMembership('239.255.255.250')
        }
      } catch (_) {}
      await new Promise((r) => this.ssdpSocket.close(() => r()))
      this.ssdpSocket = null
    }
    await this.audioEngine.stop()
    this.transportState = 'STOPPED'
    this.currentUri = ''
    this.trackDurationSec = 0
    this.currentDidlXml = ''
    this.dlnaMeta = {
      title: '',
      artist: '',
      album: '',
      albumArtUrl: ''
    }
    await this._closeHttpOnly()
    this.running = false
    this._broadcastStatus()
    return { ok: true }
  }

  _notifyPacketStrings(nts) {
    const loc = `${this.baseUrl}/rootDesc.xml`
    const deviceSt1 = 'urn:schemas-upnp-org:device:MediaRenderer:1'
    const deviceSt2 = 'urn:schemas-upnp-org:device:MediaRenderer:2'
    const avtSt = 'urn:schemas-upnp-org:service:AVTransport:1'
    const cmSt = 'urn:schemas-upnp-org:service:ConnectionManager:1'
    const rcSt = 'urn:schemas-upnp-org:service:RenderingControl:1'
    const pairs = [
      ['upnp:rootdevice', `${this.udn}::upnp:rootdevice`],
      [this.udn, this.udn],
      [deviceSt1, `${this.udn}::${deviceSt1}`],
      [deviceSt2, `${this.udn}::${deviceSt2}`],
      [cmSt, `${this.udn}::${cmSt}`],
      [rcSt, `${this.udn}::${rcSt}`],
      [avtSt, `${this.udn}::${avtSt}`]
    ]
    return pairs.map(([nt, usn]) =>
      [
        'NOTIFY * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        `NT: ${nt}`,
        `NTS: ${nts}`,
        `USN: ${usn}`,
        `LOCATION: ${loc}`,
        'CACHE-CONTROL: max-age=1800',
        'SERVER: UPnP/1.0 ECHO/1.0',
        '',
        ''
      ].join('\r\n')
    )
  }

  _sendNotify(nts) {
    if (!this.ssdpSocket || !this.baseUrl) return
    for (const msg of this._notifyPacketStrings(nts)) {
      const buf = Buffer.from(msg)
      this.ssdpSocket.send(buf, 0, buf.length, 1900, '239.255.255.250', () => {})
    }
  }

  _sendSsdpResponse(respondSt, respondUsn, rinfo) {
    if (!this.ssdpSocket || !this.baseUrl) return
    const loc = `${this.baseUrl}/rootDesc.xml`
    const date = new Date().toUTCString()
    const resp = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'EXT:',
      `DATE: ${date}`,
      `LOCATION: ${loc}`,
      'SERVER: UPnP/1.0 ECHO/1.0',
      `ST: ${respondSt}`,
      `USN: ${respondUsn}`,
      '',
      ''
    ].join('\r\n')
    const buf = Buffer.from(resp)
    this.ssdpSocket.send(buf, 0, buf.length, rinfo.port, rinfo.address, () => {})
  }

  _onSsdpMessage(msg, rinfo) {
    const text = msg.toString('utf8')
    if (!text.startsWith('M-SEARCH')) return
    const lines = text.split(/\r?\n/)
    let st = ''
    for (const line of lines) {
      const m = line.match(/^ST:\s*(.+)\s*$/i)
      if (m) st = m[1].trim().replace(/^["']|["']$/g, '')
    }
    if (process.env.ECHOES_DLNA_DEBUG) {
      console.log('[DLNA] M-SEARCH ST=', JSON.stringify(st), 'from', rinfo.address)
    }

    const deviceSt1 = 'urn:schemas-upnp-org:device:MediaRenderer:1'
    const deviceSt2 = 'urn:schemas-upnp-org:device:MediaRenderer:2'
    const avtSt = 'urn:schemas-upnp-org:service:AVTransport:1'
    const cmSt = 'urn:schemas-upnp-org:service:ConnectionManager:1'
    const rcSt = 'urn:schemas-upnp-org:service:RenderingControl:1'
    const uuidSt = this.udn

    if (st === 'ssdp:all') {
      const replies = [
        ['upnp:rootdevice', `${this.udn}::upnp:rootdevice`],
        [uuidSt, this.udn],
        [deviceSt1, `${this.udn}::${deviceSt1}`],
        [deviceSt2, `${this.udn}::${deviceSt2}`],
        [cmSt, `${this.udn}::${cmSt}`],
        [rcSt, `${this.udn}::${rcSt}`],
        [avtSt, `${this.udn}::${avtSt}`]
      ]
      for (const [respondSt, respondUsn] of replies) {
        this._sendSsdpResponse(respondSt, respondUsn, rinfo)
      }
      return
    }

    let respondSt = ''
    let respondUsn = ''
    if (st === 'upnp:rootdevice') {
      respondSt = 'upnp:rootdevice'
      respondUsn = `${this.udn}::upnp:rootdevice`
    } else if (this.deviceUuid && new RegExp(`^uuid:${this.deviceUuid}$`, 'i').test(st)) {
      respondSt = `uuid:${this.deviceUuid}`
      respondUsn = this.udn
    } else if (st === deviceSt1) {
      respondSt = deviceSt1
      respondUsn = `${this.udn}::${deviceSt1}`
    } else if (st === deviceSt2) {
      respondSt = deviceSt2
      respondUsn = `${this.udn}::${deviceSt2}`
    } else if (st === avtSt) {
      respondSt = avtSt
      respondUsn = `${this.udn}::${avtSt}`
    } else if (st === cmSt) {
      respondSt = cmSt
      respondUsn = `${this.udn}::${cmSt}`
    } else if (st === rcSt) {
      respondSt = rcSt
      respondUsn = `${this.udn}::${rcSt}`
    } else {
      return
    }

    this._sendSsdpResponse(respondSt, respondUsn, rinfo)
  }

  _deviceDescription() {
    const base = this.baseUrl
    const name = escapeXml(this.friendlyName)
    return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <URLBase>${base}/</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>${name}</friendlyName>
    <manufacturer>ECHO</manufacturer>
    <manufacturerURL>https://github.com</manufacturerURL>
    <modelDescription>ECHO DLNA MediaRenderer</modelDescription>
    <modelName>ECHORenderer</modelName>
    <modelNumber>1</modelNumber>
    <UDN>${this.udn}</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <SCPDURL>/scpd/ConnectionManager.xml</SCPDURL>
        <controlURL>/ctrl/ConnectionManager</controlURL>
        <eventSubURL>/evt/ConnectionManager</eventSubURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId>
        <SCPDURL>/scpd/RenderingControl.xml</SCPDURL>
        <controlURL>/ctrl/RenderingControl</controlURL>
        <eventSubURL>/evt/RenderingControl</eventSubURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
        <SCPDURL>/scpd/AVTransport.xml</SCPDURL>
        <controlURL>/ctrl/AVTransport</controlURL>
        <eventSubURL>/evt/AVTransport</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`
  }

  _onHttp(req, res) {
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.httpPort}`)
    const path = url.pathname

    if (req.method === 'GET' && path === '/rootDesc.xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
      res.end(this._deviceDescription())
      return
    }
    if (req.method === 'GET' && path === '/scpd/ConnectionManager.xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
      res.end(SCPD_CONNECTION_MANAGER)
      return
    }
    if (req.method === 'GET' && path === '/scpd/RenderingControl.xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
      res.end(SCPD_RENDERING_CONTROL)
      return
    }
    if (req.method === 'GET' && path === '/scpd/AVTransport.xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
      res.end(SCPD_AV_TRANSPORT)
      return
    }

    if (req.method === 'POST' && path.startsWith('/ctrl/')) {
      let body = ''
      req.on('data', (c) => {
        body += c
        if (body.length > 2 * 1024 * 1024) req.destroy()
      })
      req.on('end', () => this._handleSoap(req, res, path, body))
      return
    }

    res.writeHead(404)
    res.end()
  }

  _parseSoapAction(req) {
    const raw = req.headers['soapaction'] || req.headers['SOAPAction'] || ''
    const s = String(raw)
      .replace(/^["']|["']$/g, '')
      .trim()
    const m = s.match(/#(\w+)\s*$/)
    return m ? m[1] : ''
  }

  _handleSoap(req, res, path, body) {
    const action = this._parseSoapAction(req)
    try {
      if (path === '/ctrl/ConnectionManager') {
        if (action === 'GetProtocolInfo') {
          const inner = `<u:GetProtocolInfoResponse xmlns:u="urn:schemas-upnp-org:service:ConnectionManager:1">
<Source></Source>
<Sink>http-get:*:audio/mpeg:*,http-get:*:audio/mp4:*,http-get:*:audio/vnd.dlna.adts:*,http-get:*:application/ogg:*,http-get:*:audio/flac:*,http-get:*:audio/x-flac:*,http-get:*:audio/wav:*</Sink>
</u:GetProtocolInfoResponse>`
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          res.end(soapEnvelope(inner))
          return
        }
        if (action === 'GetCurrentConnectionIDs') {
          const inner = `<u:GetCurrentConnectionIDsResponse xmlns:u="urn:schemas-upnp-org:service:ConnectionManager:1">
<ConnectionIDs>0</ConnectionIDs>
</u:GetCurrentConnectionIDsResponse>`
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          res.end(soapEnvelope(inner))
          return
        }
        if (action === 'PrepareForConnection') {
          const inner = `<u:PrepareForConnectionResponse xmlns:u="urn:schemas-upnp-org:service:ConnectionManager:1">
<ConnectionID>0</ConnectionID>
<AVTransportID>0</AVTransportID>
<RcsID>0</RcsID>
</u:PrepareForConnectionResponse>`
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          res.end(soapEnvelope(inner))
          return
        }
      }
      if (path === '/ctrl/RenderingControl') {
        if (action === 'ListPresets') {
          const inner = `<u:ListPresetsResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
<CurrentPresetNameList>FactoryDefaults</CurrentPresetNameList>
</u:ListPresetsResponse>`
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          res.end(soapEnvelope(inner))
          return
        }
        if (action === 'GetVolume') {
          const pct = Math.round(
            (typeof this.audioEngine.getVolume === 'function' ? this.audioEngine.getVolume() : 1) *
              100
          )
          const inner = `<u:GetVolumeResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
<CurrentVolume>${pct}</CurrentVolume>
</u:GetVolumeResponse>`
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          res.end(soapEnvelope(inner))
          return
        }
        if (action === 'SetVolume') {
          const dv = extractSoapValue(body, 'DesiredVolume')
          const n = parseInt(dv, 10)
          if (Number.isFinite(n)) {
            this.audioEngine.setVolume(Math.min(1, Math.max(0, n / 100)))
          }
          const inner = `<u:SetVolumeResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"></u:SetVolumeResponse>`
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          res.end(soapEnvelope(inner))
          return
        }
        if (action === 'GetMute') {
          const inner = `<u:GetMuteResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
<CurrentMute>0</CurrentMute>
</u:GetMuteResponse>`
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          res.end(soapEnvelope(inner))
          return
        }
        if (action === 'SetMute') {
          const inner = `<u:SetMuteResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"></u:SetMuteResponse>`
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          res.end(soapEnvelope(inner))
          return
        }
      }
      if (path === '/ctrl/AVTransport') {
        this._handleAvTransport(action, body, res)
        return
      }
    } catch (e) {
      console.error('[DLNA] SOAP error', e)
    }
    res.writeHead(500)
    res.end()
  }

  async _handleAvTransport(action, body, res) {
    const respond = (inner) => {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
      res.end(soapEnvelope(inner))
    }

    if (action === 'SetAVTransportURI') {
      let uri = extractSoapValue(body, 'CurrentURI')
      if (/^https?:\/\//i.test(uri)) uri = uri.replace(/&amp;/gi, '&')
      this.currentUri = uri || ''
      let metaXml = extractSoapValue(body, 'CurrentURIMetaData')
      if (metaXml && metaXml.length > DIDL_MAX) metaXml = metaXml.slice(0, DIDL_MAX)
      this.currentDidlXml = metaXml || ''
      const rawMeta = parseDidlLiteMetadata(this.currentDidlXml)
      const refined = refineDlnaMeta(rawMeta, this.currentUri, this.currentDidlXml)
      this.dlnaMeta = refined.meta
      if (!this.currentUri) {
        this.currentDidlXml = ''
        this.dlnaMeta = {
          title: '',
          artist: '',
          album: '',
          albumArtUrl: ''
        }
      }
      this.transportState = 'STOPPED'
      let probed = 0
      if (this.currentUri) {
        probed = await this._probeDuration(this.currentUri)
      }
      const hint = refined.durationHintSec || 0
      this.trackDurationSec = Math.max(probed, hint, 0)
      await this.audioEngine.stop()
      respond(
        `<u:SetAVTransportURIResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:SetAVTransportURIResponse>`
      )
      this._broadcastStatus()
      return
    }

    if (action === 'GetTransportInfo') {
      const state = this.transportState
      respond(`<u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<CurrentTransportState>${state}</CurrentTransportState>
<CurrentTransportStatus>OK</CurrentTransportStatus>
<CurrentSpeed>1</CurrentSpeed>
</u:GetTransportInfoResponse>`)
      return
    }

    if (action === 'GetMediaInfo') {
      const st = this.audioEngine.getStatus()
      const dur = secToRelTime(
        this.trackDurationSec > 0 ? this.trackDurationSec : st.currentTime || 0
      )
      const uri = escapeXml(this.currentUri || '')
      const uriMetaInner = wrapDidlForSoapCdata(this.currentDidlXml)
      respond(`<u:GetMediaInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<NrTracks>1</NrTracks>
<MediaDuration>${dur}</MediaDuration>
<CurrentURI>${uri}</CurrentURI>
<CurrentURIMetaData>${uriMetaInner}</CurrentURIMetaData>
</u:GetMediaInfoResponse>`)
      return
    }

    if (action === 'GetTransportSettings') {
      respond(`<u:GetTransportSettingsResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<PlayMode>NORMAL</PlayMode>
<RecQualityMode>NOT_IMPLEMENTED</RecQualityMode>
</u:GetTransportSettingsResponse>`)
      return
    }

    if (action === 'GetDeviceCapabilities') {
      respond(`<u:GetDeviceCapabilitiesResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<PlayMedia>NETWORK,UNKNOWN</PlayMedia>
<RecMedia>NOT_IMPLEMENTED</RecMedia>
<RecQualityModes>NOT_IMPLEMENTED</RecQualityModes>
</u:GetDeviceCapabilitiesResponse>`)
      return
    }

    if (action === 'GetCurrentTransportActions') {
      respond(`<u:GetCurrentTransportActionsResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<Actions>Play,Pause,Stop,Seek</Actions>
</u:GetCurrentTransportActionsResponse>`)
      return
    }

    if (action === 'GetPositionInfo') {
      const st = this.audioEngine.getStatus()
      const rel = secToRelTime(st.currentTime || 0)
      const dur = secToRelTime(
        this.trackDurationSec > 0 ? this.trackDurationSec : st.currentTime || 0
      )
      const uri = escapeXml(this.currentUri || '')
      const trackMetaInner = wrapDidlForSoapCdata(this.currentDidlXml)
      respond(`<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<Track>1</Track>
<TrackDuration>${dur}</TrackDuration>
<TrackMetaData>${trackMetaInner}</TrackMetaData>
<TrackURI>${uri}</TrackURI>
<RelTime>${rel}</RelTime>
<AbsTime>${rel}</AbsTime>
<RelCount>0</RelCount>
<AbsCount>0</AbsCount>
</u:GetPositionInfoResponse>`)
      return
    }

    if (action === 'Play') {
      if (!this.currentUri || !/^https?:\/\//i.test(this.currentUri)) {
        respond(
          `<u:PlayResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:PlayResponse>`
        )
        return
      }
      if (this.beforePlayHook) await this.beforePlayHook()
      this._notifyPauseLocal()
      const r = await this.audioEngine.play(this.currentUri, 0, 1.0)
      if (r.success) {
        this.transportState = 'PLAYING'
        if (this.trackDurationSec <= 0 && this.currentUri) {
          this._probeDuration(this.currentUri).then((d) => {
            if (d > 0) {
              this.trackDurationSec = d
              this._broadcastStatus()
            }
          })
        }
      } else {
        this.lastError = r.error || 'play_failed'
        this.transportState = 'STOPPED'
      }
      respond(
        `<u:PlayResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:PlayResponse>`
      )
      this._broadcastStatus()
      return
    }

    if (action === 'Pause') {
      await this.audioEngine.pause()
      this.transportState = 'PAUSED_PLAYBACK'
      respond(
        `<u:PauseResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:PauseResponse>`
      )
      this._broadcastStatus()
      return
    }

    if (action === 'Stop') {
      await this.audioEngine.stop()
      this.transportState = 'STOPPED'
      respond(
        `<u:StopResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:StopResponse>`
      )
      this._broadcastStatus()
      return
    }

    if (action === 'Seek') {
      const unit = extractSoapValue(body, 'Unit')
      const target = extractSoapValue(body, 'Target')
      let sec = 0
      if (unit && /TIME/i.test(unit)) sec = parseSeekTarget(target)
      if (this.currentUri && /^https?:\/\//i.test(this.currentUri)) {
        if (this.beforePlayHook) await this.beforePlayHook()
        this._notifyPauseLocal()
        const r = await this.audioEngine.play(this.currentUri, sec, 1.0)
        if (r.success) this.transportState = 'PLAYING'
      }
      respond(
        `<u:SeekResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:SeekResponse>`
      )
      this._broadcastStatus()
      return
    }

    respond(
      `<u:${action}Response xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:${action}Response>`
    )
  }
}
