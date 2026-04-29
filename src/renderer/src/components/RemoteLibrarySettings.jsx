import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FolderOpen, Loader2, Plus, Radio, Trash2 } from 'lucide-react'

const FILE_BACKED_TYPES = new Set(['networkFolder', 'sshfs'])

function defaultNameForType(type = 'subsonic') {
  if (type === 'webdav') return 'WebDAV Music'
  if (type === 'sshfs') return 'SSHFS Music'
  if (type === 'networkFolder') return 'NAS Music'
  return 'ECHO Navidrome'
}

function emptyForm(type = 'subsonic') {
  return {
    id: '',
    type,
    name: defaultNameForType(type),
    serverUrl: '',
    folderPath: '',
    username: '',
    password: ''
  }
}

function sourceLabel(source) {
  if (source?.type === 'webdav') return source.name || 'WebDAV Music'
  if (source?.type === 'sshfs') return source.name || 'SSHFS Music'
  if (source?.type === 'networkFolder') return source.name || 'NAS Music'
  return source?.name || 'Navidrome'
}

function typeLabel(type) {
  if (type === 'webdav') return 'WebDAV'
  if (type === 'sshfs') return 'SSHFS'
  if (type === 'networkFolder') return 'NAS / SMB'
  return 'Subsonic / Navidrome'
}

export default function RemoteLibrarySettings({
  sources = [],
  encryptionAvailable = false,
  onReload,
  onSelectSource
}) {
  const [form, setForm] = useState(() => emptyForm())
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedSource = useMemo(
    () => sources.find(source => source.id === form.id) || null,
    [form.id, sources]
  )
  const isFileBackedSource = FILE_BACKED_TYPES.has(form.type)
  const isWebDav = form.type === 'webdav'
  const isSshfs = form.type === 'sshfs'

  useEffect(() => {
    if (!selectedSource) return
    setForm({
      id: selectedSource.id,
      type: selectedSource.type || 'subsonic',
      name: sourceLabel(selectedSource),
      serverUrl: selectedSource.serverUrl || '',
      folderPath: selectedSource.folderPath || '',
      username: selectedSource.username || '',
      password: ''
    })
  }, [selectedSource])

  const update = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const switchType = (type) => {
    setForm(prev => ({
      ...emptyForm(type),
      id: '',
      name: prev.name && prev.id ? prev.name : defaultNameForType(type)
    }))
  }

  const run = async (task) => {
    setBusy(true)
    setStatus('')
    try {
      return await task()
    } finally {
      setBusy(false)
    }
  }

  const pickFolder = async () => {
    const folders = await window.api?.openDirectoryHandler?.()
    if (folders?.[0]) {
      update('folderPath', folders[0])
    }
  }

  const testConnection = async () => {
    await run(async () => {
      const result = await window.api.remoteLibrary.testSource(form)
      setStatus(result?.ok ? '连接成功' : `连接失败：${result?.error || '未知错误'}`)
    })
  }

  const save = async () => {
    await run(async () => {
      const result = await window.api.remoteLibrary.saveSource(form)
      if (result?.ok) {
        setStatus('已保存远程音乐库')
        await onReload?.()
        onSelectSource?.(result.source?.id)
      } else {
        setStatus(`保存失败：${result?.error || '未知错误'}`)
      }
    })
  }

  const remove = async (sourceId) => {
    await run(async () => {
      const result = await window.api.remoteLibrary.removeSource(sourceId)
      if (result?.ok) {
        setStatus('已移除远程音乐库')
        setForm(emptyForm())
        await onReload?.()
      } else {
        setStatus(`移除失败：${result?.error || '未知错误'}`)
      }
    })
  }

  return (
    <div className="remote-library-settings">
      <div className="settings-subsection-header">
        <div>
          <h3>Navidrome / Subsonic / WebDAV / NAS / SSHFS</h3>
          <p>
            连接音乐服务器，或把 WebDAV、NAS、SMB 共享、SSHFS 挂载盘作为独立来源浏览。
          </p>
        </div>
        <button type="button" className="ghost-button compact" onClick={() => setForm(emptyForm(form.type))}>
          <Plus size={16} />
          新连接
        </button>
      </div>

      <div className="remote-source-type-switch">
        {['subsonic', 'webdav', 'networkFolder', 'sshfs'].map(type => (
          <button
            key={type}
            type="button"
            className={form.type === type ? 'active' : ''}
            onClick={() => switchType(type)}
          >
            {typeLabel(type)}
          </button>
        ))}
      </div>

      {sources.length > 0 && (
        <div className="remote-source-list">
          {sources.map(source => (
            <button
              key={source.id}
              type="button"
              className={`remote-source-chip ${source.id === form.id ? 'active' : ''}`}
              onClick={() => setForm({
                id: source.id,
                type: source.type || 'subsonic',
                name: sourceLabel(source),
                serverUrl: source.serverUrl || '',
                folderPath: source.folderPath || '',
                username: source.username || '',
                password: ''
              })}
            >
              <Radio size={15} />
              <span>{sourceLabel(source)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="settings-form-grid remote-library-form">
        <label>
          <span>显示名称</span>
          <input value={form.name} onChange={event => update('name', event.target.value)} />
        </label>

        {isFileBackedSource ? (
          <label className="remote-library-folder-field">
            <span>{isSshfs ? 'SSHFS 挂载路径' : '文件夹路径'}</span>
            <div className="remote-library-path-picker">
              <input
                value={form.folderPath}
                placeholder={isSshfs ? 'Z:\\Music 或 /mnt/music' : '\\\\NAS\\Music 或 Z:\\Music'}
                onChange={event => update('folderPath', event.target.value)}
              />
              <button type="button" className="secondary-action-button" onClick={pickFolder}>
                <FolderOpen size={16} />
                选择
              </button>
            </div>
          </label>
        ) : (
          <>
            <label>
              <span>{isWebDav ? 'WebDAV URL' : '服务器 URL'}</span>
              <input
                value={form.serverUrl}
                placeholder={isWebDav ? 'https://nas.local/dav/music' : 'http://192.168.1.10:4533'}
                onChange={event => update('serverUrl', event.target.value)}
              />
            </label>
            <label>
              <span>{isWebDav ? '用户名（可选）' : '用户名'}</span>
              <input value={form.username} onChange={event => update('username', event.target.value)} />
            </label>
            <label>
              <span>
                {selectedSource?.hasPassword
                  ? isWebDav
                    ? '密码（留空保持不变）'
                    : '密码/API 密码（留空保持不变）'
                  : isWebDav
                    ? '密码（可选）'
                    : '密码/API 密码'}
              </span>
              <input
                type="password"
                value={form.password}
                onChange={event => update('password', event.target.value)}
              />
            </label>
          </>
        )}
      </div>

      {!isFileBackedSource && (
        <div className="settings-inline-note">
          {encryptionAvailable
            ? '密码会用系统安全存储加密保存。'
            : '当前系统安全存储不可用，ECHO 不会明文保存密码。'}
        </div>
      )}

      {form.type === 'webdav' && (
        <div className="settings-inline-note">
          WebDAV 会通过目录枚举浏览音乐文件，播放时临时生成带鉴权的流 URL，不把密码写进歌单或队列。
        </div>
      )}

      {form.type === 'networkFolder' && (
        <div className="settings-inline-note">
          支持 Windows UNC、SMB 共享、映射盘和本机可访问的网络路径；播放时会按原文件路径交给当前音频输出。
        </div>
      )}

      {form.type === 'sshfs' && (
        <div className="settings-inline-note">
          请先用 SSHFS-Win、WinFsp 或系统 sshfs 工具挂载远端目录，再把挂载后的盘符或目录填到这里；ECHO 不保存 SSH 密钥或服务器密码。
        </div>
      )}

      <div className="settings-actions-row">
        <button type="button" className="secondary-action-button" onClick={testConnection} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
          测试连接
        </button>
        <button type="button" className="primary-action-button" onClick={save} disabled={busy}>
          保存
        </button>
        {form.id && (
          <button
            type="button"
            className="danger-action-button"
            onClick={() => remove(form.id)}
            disabled={busy}
          >
            <Trash2 size={16} />
            移除
          </button>
        )}
      </div>

      {status && <div className="settings-inline-note strong">{status}</div>}
    </div>
  )
}
