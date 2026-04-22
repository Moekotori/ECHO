const DEFAULT_WS_PATH = '/ws'

export class ListenTogetherClient {
  constructor({ serverBaseUrl, onMessage, onOpen, onClose }) {
    this.serverBaseUrl = serverBaseUrl
    this.onMessage = onMessage
    this.onOpen = onOpen
    this.onClose = onClose
    this.ws = null
    this.reconnectTimer = null
    this.heartbeatTimer = null
    this.closedByUser = false
  }

  connect() {
    if (!this.serverBaseUrl) throw new Error('server_base_url_required')
    this.closedByUser = false
    const wsUrl = toWsUrl(this.serverBaseUrl, DEFAULT_WS_PATH)
    this.ws = new WebSocket(wsUrl)
    this.ws.addEventListener('open', () => {
      if (typeof this.onOpen === 'function') this.onOpen()
      this.startHeartbeat()
    })
    this.ws.addEventListener('close', () => {
      this.stopHeartbeat()
      if (typeof this.onClose === 'function') this.onClose()
      if (!this.closedByUser) this.scheduleReconnect()
    })
    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (typeof this.onMessage === 'function') this.onMessage(msg)
      } catch (_) {
        // ignore malformed WS payload
      }
    })
  }

  disconnect() {
    this.closedByUser = true
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.ws) this.ws.close()
    this.ws = null
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ type, payload }))
    return true
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 1500)
  }

  startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send('ping', { clientNow: Date.now() })
    }, 5000)
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}

function toWsUrl(base, wsPath) {
  const u = new URL(base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = wsPath
  u.search = ''
  u.hash = ''
  return u.toString()
}
