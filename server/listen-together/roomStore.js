const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function genRoomId(len = 6) {
  let out = ''
  for (let i = 0; i < len; i += 1) {
    out += ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]
  }
  return out
}

function now() {
  return Date.now()
}

export class RoomStore {
  constructor() {
    this.rooms = new Map()
  }

  createRoom(hostId, payload = {}) {
    let roomId = genRoomId()
    while (this.rooms.has(roomId)) roomId = genRoomId()
    const room = {
      roomId,
      hostId,
      lockJoinKey: !!payload.lockJoinKey,
      roomAccessKey: payload.roomAccessKey || '',
      createdAt: now(),
      updatedAt: now(),
      members: new Map(),
      playback: {
        trackId: payload.trackId || '',
        title: payload.title || '',
        artist: payload.artist || '',
        isPlaying: !!payload.isPlaying,
        positionSec: Number(payload.positionSec) || 0,
        startedAt: payload.startedAt || null,
        pausedAt: payload.pausedAt || now(),
        sourceType: payload.sourceType || 'url',
        streamUrl: payload.streamUrl || '',
        mediaId: payload.mediaId || ''
      }
    }
    this.rooms.set(roomId, room)
    return room
  }

  getRoom(roomId) {
    return this.rooms.get((roomId || '').trim().toUpperCase()) || null
  }

  joinRoom(roomId, memberId, meta = {}) {
    const room = this.getRoom(roomId)
    if (!room) return null
    if (room.lockJoinKey) {
      const provided = String(meta.roomAccessKey || '').trim()
      if (!provided || provided !== room.roomAccessKey) return null
    }
    room.members.set(memberId, {
      memberId,
      name: meta.name || `User-${memberId.slice(0, 4)}`,
      role: memberId === room.hostId ? 'host' : 'member',
      joinedAt: now(),
      lastSeenAt: now()
    })
    room.updatedAt = now()
    return room
  }

  leaveRoom(roomId, memberId) {
    const room = this.getRoom(roomId)
    if (!room) return null
    room.members.delete(memberId)
    if (memberId === room.hostId) {
      const nextHost = room.members.values().next().value
      if (!nextHost) {
        this.rooms.delete(room.roomId)
        return null
      }
      room.hostId = nextHost.memberId
      nextHost.role = 'host'
    }
    room.updatedAt = now()
    return room
  }

  updatePlayback(roomId, patch = {}) {
    const room = this.getRoom(roomId)
    if (!room) return null
    room.playback = {
      ...room.playback,
      ...patch
    }
    room.updatedAt = now()
    return room
  }

  transferHost(roomId, fromMemberId, toMemberId) {
    const room = this.getRoom(roomId)
    if (!room) return null
    if (room.hostId !== fromMemberId) return null
    const target = room.members.get(toMemberId)
    const current = room.members.get(fromMemberId)
    if (!target) return null
    room.hostId = toMemberId
    if (current) current.role = 'member'
    target.role = 'host'
    room.updatedAt = now()
    return room
  }

  touch(roomId, memberId) {
    const room = this.getRoom(roomId)
    if (!room) return
    const m = room.members.get(memberId)
    if (m) m.lastSeenAt = now()
  }

  serializeRoom(room) {
    if (!room) return null
    return {
      roomId: room.roomId,
      hostId: room.hostId,
      lockJoinKey: !!room.lockJoinKey,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      members: Array.from(room.members.values()).map((m) => ({
        memberId: m.memberId,
        name: m.name,
        role: m.role,
        joinedAt: m.joinedAt,
        lastSeenAt: m.lastSeenAt
      })),
      playback: { ...room.playback },
      serverNow: now()
    }
  }
}
