import http from 'node:http'
import fs from 'node:fs'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { RoomStore } from './roomStore.js'
import { MediaStore } from './mediaStore.js'
import { verifyToken } from './auth.js'

const PORT = Number(process.env.PORT || 8787)
const roomStore = new RoomStore()
const mediaStore = new MediaStore({})
const wsClients = new Map() // memberId => ws
const memberRoom = new Map() // memberId => roomId

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_, res) => {
  res.json({ ok: true, service: 'listen-together', now: Date.now() })
})

app.post('/media/upload/init', (req, res) => {
  const auth = verifyToken(req)
  if (!auth.ok) return res.status(401).json(auth)
  const { roomId, title, artist } = req.body || {}
  const room = roomStore.getRoom(roomId)
  if (!room) return res.status(404).json({ ok: false, error: 'room_not_found' })
  const item = mediaStore.createUpload(room.roomId, { title, artist })
  return res.json({ ok: true, mediaId: item.mediaId })
})

app.post('/media/upload/chunk', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  const auth = verifyToken(req)
  if (!auth.ok) return res.status(401).json(auth)
  const mediaId = (req.query.mediaId || '').toString()
  if (!mediaId) return res.status(400).json({ ok: false, error: 'media_id_required' })
  const out = mediaStore.appendChunk(mediaId, Buffer.from(req.body || []))
  if (!out.ok) return res.status(400).json(out)
  return res.json(out)
})

app.post('/media/upload/finish', (req, res) => {
  const auth = verifyToken(req)
  if (!auth.ok) return res.status(401).json(auth)
  const { mediaId } = req.body || {}
  const item = mediaStore.finish(mediaId)
  if (!item) return res.status(404).json({ ok: false, error: 'media_not_found' })
  const streamPath = `/media/stream/${item.mediaId}`
  res.json({
    ok: true,
    mediaId: item.mediaId,
    streamUrl: `${req.protocol}://${req.get('host')}${streamPath}`
  })
})

app.get('/media/stream/:mediaId', (req, res) => {
  const auth = verifyToken(req)
  if (!auth.ok) return res.status(401).json(auth)
  const item = mediaStore.get(req.params.mediaId)
  if (!item) return res.status(404).end()
  res.setHeader('Content-Type', 'audio/mpeg')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-store')
  const range = req.headers.range
  if (!range) {
    return res.sendFile(item.filePath)
  }
  const size = item.size
  const [startRaw, endRaw] = range.replace(/bytes=/, '').split('-')
  const start = Number(startRaw)
  const end = endRaw ? Number(endRaw) : size - 1
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
    return res.status(416).end()
  }
  res.status(206)
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  res.setHeader('Content-Length', String(end - start + 1))
  fs.createReadStream(item.filePath, { start, end }).pipe(res)
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

function send(ws, type, payload = {}) {
  if (ws.readyState !== ws.OPEN) return
  ws.send(JSON.stringify({ type, payload }))
}

function broadcastRoom(roomId, type, payload) {
  for (const [memberId, rId] of memberRoom.entries()) {
    if (rId !== roomId) continue
    const ws = wsClients.get(memberId)
    if (ws) send(ws, type, payload)
  }
}

function leaveCurrentRoom(memberId) {
  const currentRoomId = memberRoom.get(memberId)
  if (!currentRoomId) return
  memberRoom.delete(memberId)
  const roomAfterLeave = roomStore.leaveRoom(currentRoomId, memberId)
  if (roomAfterLeave) {
    broadcastRoom(currentRoomId, 'room:presence', roomStore.serializeRoom(roomAfterLeave))
  }
}

wss.on('connection', (ws, _req) => {
  const memberId = cryptoRandomId()
  wsClients.set(memberId, ws)
  send(ws, 'hello', { memberId, serverNow: Date.now() })

  ws.on('message', (buf) => {
    let msg
    try {
      msg = JSON.parse(buf.toString())
    } catch {
      send(ws, 'error', { error: 'invalid_json' })
      return
    }
    const type = msg?.type
    const payload = msg?.payload || {}
    if (type === 'room:create') {
      leaveCurrentRoom(memberId)
      const room = roomStore.createRoom(memberId, {
        ...(payload.playback || {}),
        lockJoinKey: !!payload.lockJoinKey,
        roomAccessKey: payload.roomAccessKey || ''
      })
      roomStore.joinRoom(room.roomId, memberId, { name: payload.name || 'Host' })
      memberRoom.set(memberId, room.roomId)
      send(ws, 'room:state', roomStore.serializeRoom(room))
      return
    }
    if (type === 'room:join') {
      leaveCurrentRoom(memberId)
      const existingRoom = roomStore.getRoom(payload.roomId)
      if (!existingRoom) return send(ws, 'error', { error: 'room_not_found' })
      if (existingRoom.lockJoinKey) {
        const key = String(payload.roomAccessKey || '').trim()
        if (!key || key !== existingRoom.roomAccessKey) {
          return send(ws, 'error', { error: 'room_locked' })
        }
      }
      const room = roomStore.joinRoom(payload.roomId, memberId, {
        name: payload.name || 'Member',
        roomAccessKey: payload.roomAccessKey || ''
      })
      if (!room) return send(ws, 'error', { error: 'room_not_found' })
      memberRoom.set(memberId, room.roomId)
      const roomState = roomStore.serializeRoom(room)
      send(ws, 'room:state', roomState)
      broadcastRoom(room.roomId, 'room:presence', roomState)
      return
    }
    if (type === 'room:leave') {
      leaveCurrentRoom(memberId)
      send(ws, 'room:left', { ok: true })
      return
    }
    const roomId = memberRoom.get(memberId)
    if (!roomId) return send(ws, 'error', { error: 'not_in_room' })
    const room = roomStore.getRoom(roomId)
    if (!room) return send(ws, 'error', { error: 'room_not_found' })
    roomStore.touch(roomId, memberId)

    if (type === 'player:update') {
      if (memberId !== room.hostId) return send(ws, 'error', { error: 'host_only' })
      const next = roomStore.updatePlayback(roomId, {
        ...payload,
        startedAt: payload.isPlaying
          ? Date.now() - Math.floor((payload.positionSec || 0) * 1000)
          : null,
        pausedAt: payload.isPlaying ? null : Date.now()
      })
      broadcastRoom(roomId, 'room:state', roomStore.serializeRoom(next))
      return
    }
    if (type === 'player:event') {
      if (memberId !== room.hostId) return send(ws, 'error', { error: 'host_only' })
      const eventType = payload.eventType || 'update'
      const next = roomStore.updatePlayback(roomId, {
        ...payload,
        lastEventType: eventType,
        startedAt: payload.isPlaying
          ? Date.now() - Math.floor((payload.positionSec || 0) * 1000)
          : room.playback.startedAt,
        pausedAt: payload.isPlaying ? null : Date.now()
      })
      broadcastRoom(roomId, 'room:state', roomStore.serializeRoom(next))
      return
    }
    if (type === 'media:publish') {
      if (memberId !== room.hostId) return send(ws, 'error', { error: 'host_only' })
      const next = roomStore.updatePlayback(roomId, {
        streamUrl: payload.streamUrl || '',
        sourceType: payload.sourceType || 'url',
        mediaId: payload.mediaId || '',
        trackId: payload.trackId || '',
        title: payload.title || '',
        artist: payload.artist || '',
        syncCover: !!payload.syncCover,
        coverUrl: payload.coverUrl || '',
        syncMv: !!payload.syncMv,
        mvSync: payload.mvSync || null,
        syncLyrics: !!payload.syncLyrics,
        syncedLyrics: Array.isArray(payload.syncedLyrics) ? payload.syncedLyrics : []
      })
      broadcastRoom(roomId, 'room:state', roomStore.serializeRoom(next))
      return
    }
    if (type === 'room:transfer-host') {
      if (memberId !== room.hostId) return send(ws, 'error', { error: 'host_only' })
      const next = roomStore.transferHost(roomId, memberId, payload.targetMemberId || '')
      if (!next) return send(ws, 'error', { error: 'transfer_failed' })
      broadcastRoom(roomId, 'room:presence', roomStore.serializeRoom(next))
      return
    }
    if (type === 'ping') {
      send(ws, 'pong', { serverNow: Date.now() })
    }
  })

  ws.on('close', () => {
    wsClients.delete(memberId)
    leaveCurrentRoom(memberId)
  })
})

setInterval(() => {
  mediaStore.cleanupExpired()
}, 60 * 1000)

server.listen(PORT, () => {
  console.log(`[listen-together] server running on :${PORT}`)
})

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10)
}
