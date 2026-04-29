import React, { useEffect, useMemo, useState } from 'react'
import { Disc3, Loader2, Play, Plus, RefreshCw, Search } from 'lucide-react'
import { formatRemoteDuration } from '../utils/remoteLibrary'

const FILE_BACKED_TYPES = new Set(['networkFolder', 'sshfs', 'webdav'])

function qualityText(track) {
  const info = track?.info || {}
  const bits = info.bitDepth ? `${info.bitDepth}bit` : ''
  const rate = info.sampleRateHz
    ? `${Math.round(Number(info.sampleRateHz) / 100) / 10}kHz`
    : info.sampleRate || ''
  return [info.codec, bits && rate ? `${bits} / ${rate}` : bits || rate, info.bitrate]
    .filter(Boolean)
    .join(' / ')
}

function sourceLabel(source) {
  if (source?.type === 'webdav') return source.name || 'WebDAV Music'
  if (source?.type === 'sshfs') return source.name || 'SSHFS Music'
  if (source?.type === 'networkFolder') return source.name || 'NAS Music'
  return source?.name || 'Navidrome'
}

export default function RemoteLibraryView({
  sources = [],
  activeSourceId,
  onActiveSourceChange,
  onOpenSettings,
  onPlayTrack,
  onQueueTrack
}) {
  const [query, setQuery] = useState('')
  const [artists, setArtists] = useState([])
  const [albums, setAlbums] = useState([])
  const [songs, setSongs] = useState([])
  const [playlists, setPlaylists] = useState([])
  const [selectedAlbum, setSelectedAlbum] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const activeSource = useMemo(
    () => sources.find(source => source.id === activeSourceId) || sources[0] || null,
    [activeSourceId, sources]
  )
  const isFileBackedSource = FILE_BACKED_TYPES.has(activeSource?.type)
  const isSubsonicSource = activeSource?.type === 'subsonic'
  const fileBackedLabel =
    activeSource?.type === 'webdav' ? 'WebDAV' : activeSource?.type === 'sshfs' ? 'SSHFS' : 'NAS'

  useEffect(() => {
    if (!activeSource && sources.length > 0) {
      onActiveSourceChange?.(sources[0].id)
    }
  }, [activeSource, onActiveSourceChange, sources])

  const loadArtists = async (sourceId = activeSource?.id) => {
    if (!sourceId) return
    setLoading(true)
    setError('')
    try {
      const result = await window.api.remoteLibrary.getArtists(sourceId)
      if (!result?.ok) throw new Error(result?.error || '加载失败')
      setArtists(result.artists || [])
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const loadPlaylists = async (sourceId = activeSource?.id) => {
    if (!sourceId || !isSubsonicSource) {
      setPlaylists([])
      return
    }
    try {
      const result = await window.api.remoteLibrary.getPlaylists(sourceId)
      setPlaylists(result?.ok ? result.playlists || [] : [])
    } catch {
      setPlaylists([])
    }
  }

  const runSearch = async (event, forcedQuery = null) => {
    event?.preventDefault?.()
    if (!activeSource?.id) return
    setLoading(true)
    setError('')
    setSelectedAlbum(null)
    try {
      const result = await window.api.remoteLibrary.search(
        activeSource.id,
        forcedQuery ?? query.trim()
      )
      if (!result?.ok) throw new Error(result?.error || '搜索失败')
      setAlbums(result.result?.albums || [])
      setSongs(result.result?.songs || [])
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setAlbums([])
    setSongs([])
    setSelectedAlbum(null)
    setPlaylists([])
    if (activeSource?.id) {
      loadArtists(activeSource.id)
      loadPlaylists(activeSource.id)
      if (FILE_BACKED_TYPES.has(activeSource.type)) {
        runSearch(null, '')
      }
    }
  }, [activeSource?.id])

  const loadSpecial = async (kind) => {
    if (!activeSource?.id || !isSubsonicSource) return
    setLoading(true)
    setError('')
    setSelectedAlbum(null)
    try {
      const result = await window.api.remoteLibrary.getSubsonicSpecial(activeSource.id, kind)
      if (!result?.ok) throw new Error(result?.error || '加载失败')
      setAlbums(result.result?.albums || [])
      setSongs(result.result?.songs || [])
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const openArtist = async (artist) => {
    if (!activeSource?.id || !artist?.id) return
    setLoading(true)
    setError('')
    setSelectedAlbum(null)
    setSongs([])
    try {
      const result = await window.api.remoteLibrary.getArtist(activeSource.id, artist.id)
      if (!result?.ok) throw new Error(result?.error || '加载失败')
      setAlbums(result.artist?.albums || [])
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const openAlbum = async (album) => {
    if (!activeSource?.id || !album?.id) return
    setLoading(true)
    setError('')
    try {
      const result = await window.api.remoteLibrary.getAlbum(activeSource.id, album.id)
      if (!result?.ok) throw new Error(result?.error || '加载失败')
      setSelectedAlbum(result.album || album)
      setSongs(result.album?.songs || [])
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const openPlaylist = async (playlist) => {
    if (!activeSource?.id || !playlist?.id) return
    setLoading(true)
    setError('')
    try {
      const result = await window.api.remoteLibrary.getPlaylist(activeSource.id, playlist.id)
      if (!result?.ok) throw new Error(result?.error || '加载失败')
      setSelectedAlbum(result.playlist || playlist)
      setAlbums([])
      setSongs(result.playlist?.songs || [])
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  if (!sources.length) {
    return (
      <div className="remote-library-empty">
        <Disc3 size={42} />
        <h2>远程音乐库</h2>
        <p>先在设置里添加 Navidrome、Subsonic、WebDAV、NAS、SMB 或 SSHFS 音乐来源。</p>
        <button type="button" className="primary-action-button" onClick={onOpenSettings}>
          添加连接
        </button>
      </div>
    )
  }

  return (
    <div className="remote-library-view">
      <div className="remote-library-toolbar">
        <select
          value={activeSource?.id || ''}
          onChange={event => onActiveSourceChange?.(event.target.value)}
        >
          {sources.map(source => (
            <option key={source.id} value={source.id}>
              {sourceLabel(source)}
            </option>
          ))}
        </select>
        <form className="remote-library-search" onSubmit={runSearch}>
          <Search size={16} />
          <input
            value={query}
            placeholder={isFileBackedSource ? `搜索 ${fileBackedLabel} 文件...` : '搜索远程曲库...'}
            onChange={event => setQuery(event.target.value)}
          />
        </form>
        <button type="button" className="icon-button" onClick={() => {
          loadArtists()
          loadPlaylists()
          if (isFileBackedSource) runSearch(null, query.trim())
        }} disabled={loading}>
          {loading ? <Loader2 size={17} className="spin" /> : <RefreshCw size={17} />}
        </button>
      </div>

      {isSubsonicSource && (
        <div className="remote-library-quick-actions">
          <button type="button" className="secondary-action-button" onClick={() => loadSpecial('starred')}>
            收藏
          </button>
          <button type="button" className="secondary-action-button" onClick={() => loadSpecial('recentlyPlayed')}>
            最近播放
          </button>
        </div>
      )}

      {error && <div className="remote-library-error">{error}</div>}

      <div className="remote-library-layout">
        <aside className="remote-artist-list">
          <div className="remote-section-title">{isFileBackedSource ? '文件夹' : '歌手'}</div>
          {artists.map(artist => (
            <button key={artist.id} type="button" onClick={() => openArtist(artist)}>
              <span>{artist.name}</span>
              <small>{artist.albumCount || ''}</small>
            </button>
          ))}
          {isSubsonicSource && playlists.length > 0 && (
            <>
              <div className="remote-section-title">服务器歌单</div>
              {playlists.map(playlist => (
                <button key={playlist.id} type="button" onClick={() => openPlaylist(playlist)}>
                  <span>{playlist.name || playlist.title}</span>
                  <small>{playlist.songCount || ''}</small>
                </button>
              ))}
            </>
          )}
        </aside>

        <main className="remote-library-main">
          {albums.length > 0 && (
            <section>
              <div className="remote-section-title">{isFileBackedSource ? '目录' : '专辑'}</div>
              <div className="remote-album-grid">
                {albums.map(album => (
                  <button
                    key={album.id}
                    type="button"
                    className="remote-album-card"
                    onClick={() => openAlbum(album)}
                  >
                    {album.cover ? <img src={album.cover} alt="" /> : <div className="remote-cover-fallback" />}
                    <strong>{album.title || album.name}</strong>
                    <span>{album.artist}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="remote-section-title">
              {selectedAlbum ? selectedAlbum.title || selectedAlbum.name : '歌曲'}
            </div>
            <div className="remote-song-list">
              {songs.map(track => (
                <div key={track.path} className="remote-song-row">
                  {track.info?.cover ? <img src={track.info.cover} alt="" /> : <div className="remote-cover-fallback" />}
                  <div className="remote-song-text">
                    <strong>{track.title || track.name}</strong>
                    <span>{track.artist}{track.album ? ` / ${track.album}` : ''}</span>
                    <small>{qualityText(track) || track.remoteActualPath || ''}</small>
                  </div>
                  <span className="remote-song-duration">{formatRemoteDuration(track.duration)}</span>
                  <button type="button" className="icon-button" onClick={() => onQueueTrack?.(track)}>
                    <Plus size={17} />
                  </button>
                  <button type="button" className="icon-button primary" onClick={() => onPlayTrack?.(track)}>
                    <Play size={17} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
