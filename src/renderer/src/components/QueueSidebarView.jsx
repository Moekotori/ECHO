import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import {
  CheckCircle2,
  GripVertical,
  ListMusic,
  Play,
  RotateCcw,
  Save,
  Shuffle,
  SkipForward,
  Trash2,
  X
} from 'lucide-react'
import { ArtistLink } from './ArtistLink'

const QUEUE_OVERSCAN = 8

function dragTransformToString(transform) {
  if (!transform) return undefined
  const x = Number.isFinite(transform.x) ? transform.x : 0
  const y = Number.isFinite(transform.y) ? transform.y : 0
  const scaleX = Number.isFinite(transform.scaleX) ? transform.scaleX : 1
  const scaleY = Number.isFinite(transform.scaleY) ? transform.scaleY : 1
  return `translate3d(${x}px, ${y}px, 0) scaleX(${scaleX}) scaleY(${scaleY})`
}

function getTrackTitle(track) {
  return track?.info?.title || track?.name || track?.path || ''
}

function getTrackArtist(track, albumArtistByName = {}) {
  const artist = track?.info?.artist || ''
  if (artist === 'Unknown Artist') return albumArtistByName[track?.info?.album] || artist
  return artist
}

const QueueRow = memo(function QueueRow({
  item,
  index,
  currentPath,
  selected,
  rowHeight,
  albumArtistByName,
  formatDuration,
  onSelect,
  onPlayNow,
  onPlayNext,
  onRemove,
  onContextMenu
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.path
  })
  const track = item.track
  const title = getTrackTitle(track)
  const artist = getTrackArtist(track, albumArtistByName)
  const album = track?.info?.album || ''
  const durationLabel =
    track?.info?.duration && track.info.duration > 0 ? formatDuration(track.info.duration) : ''
  const isActive = currentPath && item.path === currentPath

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: dragTransformToString(transform),
        transition,
        minHeight: `${Math.max(0, rowHeight - 5)}px`
      }}
      className={`track-item queue-sidebar-item${isActive ? ' active' : ''}${selected ? ' queue-sidebar-item--selected' : ''}${isDragging ? ' queue-sidebar-item--dragging' : ''}`}
      data-track-path={item.path}
      tabIndex={selected ? 0 : -1}
      onClick={(event) => {
        onSelect(item.path, event)
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onPlayNow(item.path)
      }}
      onDoubleClick={() => onPlayNow(item.path)}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(item.path, event.clientX, event.clientY)
      }}
    >
      <button
        type="button"
        className="queue-sidebar-handle"
        title="Reorder"
        aria-label="Reorder queue item"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <span className="queue-sidebar-index">{index + 1}</span>
      <div className={`track-art${isActive ? ' track-art--playing' : ''}`} aria-hidden>
        {track?.info?.cover ? <img src={track.info.cover} alt="" draggable={false} /> : <ListMusic size={17} />}
      </div>
      <div className="track-text-group">
        <div className="track-name" title={title}>
          {isActive && <span className="track-playing-dot" aria-hidden />}
          {title}
        </div>
        <div className="track-subtitle" title={[artist, album].filter(Boolean).join(' - ')}>
          <ArtistLink artist={artist} className="artist-link-subtle" stopPropagation noLink />{' '}
          {album ? `- ${album}` : ''}
        </div>
      </div>
      <span className="track-row-meta">{durationLabel}</span>
      <div className="queue-sidebar-row-actions">
        <button
          type="button"
          className="track-add-pl-btn"
          title="Play next"
          onClick={(event) => {
            event.stopPropagation()
            onPlayNext(item.path)
          }}
        >
          <SkipForward size={15} />
        </button>
        <button
          type="button"
          className="track-remove-pl-btn"
          title="Remove"
          onClick={(event) => {
            event.stopPropagation()
            onRemove(item.path)
          }}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
})

export default function QueueSidebarView({
  items,
  currentPath,
  rowHeight = 75,
  queueDragOver,
  queuePlaybackEnabled,
  canUndo,
  albumArtistByName,
  formatDuration,
  onExternalDragOver,
  onExternalDragLeave,
  onExternalDrop,
  onReorder,
  onRemove,
  onRemoveMany,
  onRemoveAbove,
  onRemoveBelow,
  onClear,
  onShuffle,
  onSaveAsPlaylist,
  onToggleQueuePlayback,
  onPlayNow,
  onPlayNext,
  onMoveTop,
  onMoveBottom,
  onUndo
}) {
  const { t } = useTranslation()
  const listRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [selectedPaths, setSelectedPaths] = useState(() => new Set())
  const [contextMenu, setContextMenu] = useState(null)
  const [toast, setToast] = useState(null)
  const lastSelectedRef = useRef('')
  const toastTimerRef = useRef(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  )

  const itemIds = useMemo(() => items.map((item) => item.path), [items])
  const totalDuration = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.track?.info?.duration) || 0), 0),
    [items]
  )
  const totalLabel = t('queue.totalCount', {
    count: items.length,
    duration: formatDuration(totalDuration),
    defaultValue: '{{count}} tracks · {{duration}}'
  })

  const visibleRange = useMemo(() => {
    if (items.length === 0) return { start: 0, end: 0, top: 0, bottom: 0 }
    const effectiveHeight = Math.max(viewportHeight, rowHeight * 8)
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - QUEUE_OVERSCAN)
    const end = Math.min(
      items.length,
      Math.ceil((scrollTop + effectiveHeight) / rowHeight) + QUEUE_OVERSCAN
    )
    return {
      start,
      end,
      top: start * rowHeight,
      bottom: Math.max(0, (items.length - end) * rowHeight)
    }
  }, [items.length, rowHeight, scrollTop, viewportHeight])

  const visibleItems = useMemo(
    () => items.slice(visibleRange.start, visibleRange.end),
    [items, visibleRange]
  )

  const selectedArray = useMemo(
    () => itemIds.filter((path) => selectedPaths.has(path)),
    [itemIds, selectedPaths]
  )

  const showToast = useCallback((message, actionLabel, action) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    setToast({ message, actionLabel, action })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setSelectedPaths((prev) => {
      const next = new Set([...prev].filter((path) => itemIds.includes(path)))
      if (next.size === prev.size) return prev
      return next
    })
  }, [itemIds])

  useEffect(() => {
    const node = listRef.current
    if (!node) return undefined
    const sync = () => {
      setViewportHeight(node.clientHeight || 0)
      setScrollTop(node.scrollTop || 0)
    }
    sync()
    if (typeof ResizeObserver === 'undefined') {
      const id = window.setInterval(sync, 250)
      return () => window.clearInterval(id)
    }
    const ro = new ResizeObserver(sync)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const selectPath = useCallback(
    (path, event) => {
      if (!path) return
      setContextMenu(null)
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        if (event?.shiftKey && lastSelectedRef.current) {
          const from = itemIds.indexOf(lastSelectedRef.current)
          const to = itemIds.indexOf(path)
          if (from !== -1 && to !== -1) {
            next.clear()
            const start = Math.min(from, to)
            const end = Math.max(from, to)
            for (let i = start; i <= end; i += 1) next.add(itemIds[i])
          }
        } else if (event?.ctrlKey || event?.metaKey) {
          if (next.has(path)) next.delete(path)
          else next.add(path)
        } else {
          next.clear()
          next.add(path)
        }
        return next
      })
      lastSelectedRef.current = path
    },
    [itemIds]
  )

  const removePath = useCallback(
    (path) => {
      const item = items.find((entry) => entry.path === path)
      onRemove(path)
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
      showToast(
        t('queue.toast.removed', {
          title: getTrackTitle(item?.track),
          defaultValue: "Removed '{{title}}'"
        }),
        t('queue.toast.undo', 'Undo'),
        onUndo
      )
    },
    [items, onRemove, onUndo, showToast, t]
  )

  const removeSelected = useCallback(() => {
    const paths = selectedArray
    if (paths.length === 0) return
    onRemoveMany(paths)
    setSelectedPaths(new Set())
    showToast(
      paths.length === 1
        ? t('queue.toast.removed', {
            title: getTrackTitle(items.find((item) => item.path === paths[0])?.track),
            defaultValue: "Removed '{{title}}'"
          })
        : t('queue.toast.cleared', {
            count: paths.length,
            defaultValue: 'Cleared {{count}} tracks'
          }),
      t('queue.toast.undo', 'Undo'),
      onUndo
    )
  }, [items, onRemoveMany, onUndo, selectedArray, showToast, t])

  const clearQueue = useCallback(() => {
    if (items.length === 0) return
    onClear()
    setSelectedPaths(new Set())
    showToast(
      t('queue.toast.cleared', {
        count: items.length,
        defaultValue: 'Cleared {{count}} tracks'
      }),
      t('queue.toast.undo', 'Undo'),
      onUndo
    )
  }, [items.length, onClear, onUndo, showToast, t])

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelectedPaths(new Set(itemIds))
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (canUndo) onUndo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeSelected()
        return
      }
      if (event.key === 'Enter') {
        const path = selectedArray[0]
        if (path) onPlayNow(path)
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const current = selectedArray[0] || currentPath || itemIds[0]
      const currentIndex = Math.max(0, itemIds.indexOf(current))
      const nextIndex =
        event.key === 'ArrowDown'
          ? Math.min(itemIds.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1)
      const nextPath = itemIds[nextIndex]
      if (!nextPath) return
      setSelectedPaths(new Set([nextPath]))
      lastSelectedRef.current = nextPath
    },
    [canUndo, currentPath, itemIds, onPlayNow, onUndo, removeSelected, selectedArray]
  )

  const handleDragEnd = useCallback(
    (event) => {
      const activePath = String(event.active?.id || '')
      const overPath = String(event.over?.id || '')
      if (!activePath) return
      if (!overPath) {
        removePath(activePath)
        return
      }
      if (activePath !== overPath) onReorder(activePath, overPath)
    },
    [onReorder, removePath]
  )

  const openContextMenu = useCallback((path, clientX, clientY) => {
    setContextMenu({ path, clientX, clientY })
    setSelectedPaths((prev) => (prev.has(path) ? prev : new Set([path])))
    lastSelectedRef.current = path
  }, [])

  const runContextAction = useCallback(
    (action) => {
      const path = contextMenu?.path
      if (!path) return
      setContextMenu(null)
      if (action === 'playNow') onPlayNow(path)
      if (action === 'playNext') onPlayNext(path)
      if (action === 'moveTop') onMoveTop(path)
      if (action === 'moveBottom') onMoveBottom(path)
      if (action === 'remove') removePath(path)
      if (action === 'removeAbove') {
        const index = itemIds.indexOf(path)
        onRemoveAbove(path)
        showToast(
          t('queue.toast.cleared', {
            count: Math.max(0, index),
            defaultValue: 'Cleared {{count}} tracks'
          }),
          t('queue.toast.undo', 'Undo'),
          onUndo
        )
      }
      if (action === 'removeBelow') {
        const index = itemIds.indexOf(path)
        onRemoveBelow(path)
        showToast(
          t('queue.toast.cleared', {
            count: Math.max(0, itemIds.length - index - 1),
            defaultValue: 'Cleared {{count}} tracks'
          }),
          t('queue.toast.undo', 'Undo'),
          onUndo
        )
      }
      if (action === 'clear') clearQueue()
      if (action === 'save') {
        const result = onSaveAsPlaylist()
        if (result?.ok) {
          showToast(
            t('queue.toast.savedAs', {
              name: result.name,
              defaultValue: "Saved as playlist '{{name}}'"
            })
          )
        }
      }
    },
    [
      clearQueue,
      contextMenu,
      itemIds,
      onMoveBottom,
      onMoveTop,
      onPlayNext,
      onPlayNow,
      onRemoveAbove,
      onRemoveBelow,
      onSaveAsPlaylist,
      onUndo,
      removePath,
      showToast,
      t
    ]
  )

  return (
    <section
      className={`queue-sidebar-view${queueDragOver ? ' queue-sidebar-view--drag-over' : ''}`}
      onDragOver={onExternalDragOver}
      onDragLeave={onExternalDragLeave}
      onDrop={(event) => {
        const result = onExternalDrop?.(event)
        if (result?.reason === 'duplicate') {
          showToast(t('queue.toast.alreadyIn', 'Already in queue'))
        }
      }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="queue-sidebar-header no-drag">
        <div>
          <div className="queue-sidebar-title">{t('queue.title', 'Up Next')}</div>
          <div className="queue-sidebar-subtitle">{totalLabel}</div>
        </div>
        <div className="queue-sidebar-actions">
          <button
            type="button"
            className={`queue-sidebar-action${queuePlaybackEnabled ? ' active' : ''}`}
            onClick={onToggleQueuePlayback}
            title={t('queue.actions.toggle', 'Use Queue')}
            aria-pressed={queuePlaybackEnabled}
          >
            <CheckCircle2 size={15} />
          </button>
          <button
            type="button"
            className="queue-sidebar-action"
            onClick={onShuffle}
            title={t('queue.actions.shuffle', 'Shuffle')}
            disabled={items.length < 2}
          >
            <Shuffle size={15} />
          </button>
          <button
            type="button"
            className="queue-sidebar-action"
            onClick={() => {
              const result = onSaveAsPlaylist()
              if (result?.ok) {
                showToast(
                  t('queue.toast.savedAs', {
                    name: result.name,
                    defaultValue: "Saved as playlist '{{name}}'"
                  })
                )
              }
            }}
            title={t('queue.actions.saveAs', 'Save as Playlist')}
            disabled={items.length === 0}
          >
            <Save size={15} />
          </button>
          <button
            type="button"
            className="queue-sidebar-action queue-sidebar-action--danger"
            onClick={clearQueue}
            title={t('queue.actions.clear', 'Clear')}
            disabled={items.length === 0}
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            className="queue-sidebar-action"
            onClick={onUndo}
            title={t('queue.toast.undo', 'Undo')}
            disabled={!canUndo}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="queue-sidebar-empty">
          <svg viewBox="0 0 96 96" aria-hidden>
            <path
              d="M25 31h38M25 47h38M25 63h24M69 54v23M58 66h22"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <circle cx="48" cy="48" r="34" fill="none" stroke="currentColor" strokeWidth="4" />
          </svg>
          <p className="app-empty-state__title">{t('queue.empty.title', 'Queue is empty')}</p>
          <p className="app-empty-state__hint">
            {t(
              'queue.empty.hint',
              "Drag songs here, or right-click any track and choose 'Add to Queue'"
            )}
          </p>
        </div>
      ) : (
        <div
          ref={listRef}
          className="queue-sidebar-list"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop || 0)}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              <div className="playlist-virtual-list queue-sidebar-virtual-list">
                {visibleRange.top > 0 && (
                  <div
                    className="playlist-spacer"
                    style={{ height: `${visibleRange.top}px` }}
                    aria-hidden
                  />
                )}
                {visibleItems.map((item, offset) => (
                  <QueueRow
                    key={item.path}
                    item={item}
                    index={visibleRange.start + offset}
                    currentPath={currentPath}
                    selected={selectedPaths.has(item.path)}
                    rowHeight={rowHeight}
                    albumArtistByName={albumArtistByName}
                    formatDuration={formatDuration}
                    onSelect={selectPath}
                    onPlayNow={onPlayNow}
                    onPlayNext={onPlayNext}
                    onRemove={removePath}
                    onContextMenu={openContextMenu}
                  />
                ))}
                {visibleRange.bottom > 0 && (
                  <div
                    className="playlist-spacer"
                    style={{ height: `${visibleRange.bottom}px` }}
                    aria-hidden
                  />
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {contextMenu && (
        <div
          className="track-ctx-menu queue-sidebar-context-menu"
          role="menu"
          style={{
            left: Math.max(8, Math.min(contextMenu.clientX, window.innerWidth - 220)),
            top: Math.max(8, Math.min(contextMenu.clientY, window.innerHeight - 340))
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" className="track-ctx-item" onClick={() => runContextAction('playNow')}>
            <Play size={14} aria-hidden /> {t('queue.contextMenu.playNow', 'Play Now')}
          </button>
          <button type="button" role="menuitem" className="track-ctx-item" onClick={() => runContextAction('playNext')}>
            <SkipForward size={14} aria-hidden /> {t('queue.contextMenu.playNext', 'Play Next')}
          </button>
          <button type="button" role="menuitem" className="track-ctx-item" onClick={() => runContextAction('moveTop')}>
            <GripVertical size={14} aria-hidden /> {t('queue.contextMenu.moveTop', 'Move to Top')}
          </button>
          <button type="button" role="menuitem" className="track-ctx-item" onClick={() => runContextAction('moveBottom')}>
            <GripVertical size={14} aria-hidden /> {t('queue.contextMenu.moveBottom', 'Move to Bottom')}
          </button>
          <button type="button" role="menuitem" className="track-ctx-item" onClick={() => runContextAction('remove')}>
            <X size={14} aria-hidden /> {t('queue.contextMenu.remove', 'Remove')}
          </button>
          <button type="button" role="menuitem" className="track-ctx-item" onClick={() => runContextAction('removeAbove')}>
            <Trash2 size={14} aria-hidden /> {t('queue.contextMenu.removeAbove', 'Remove all above')}
          </button>
          <button type="button" role="menuitem" className="track-ctx-item" onClick={() => runContextAction('removeBelow')}>
            <Trash2 size={14} aria-hidden /> {t('queue.contextMenu.removeBelow', 'Remove all below')}
          </button>
          <button type="button" role="menuitem" className="track-ctx-item" onClick={() => runContextAction('clear')}>
            <Trash2 size={14} aria-hidden /> {t('queue.contextMenu.clearQueue', 'Clear Queue')}
          </button>
          <button type="button" role="menuitem" className="track-ctx-item" onClick={() => runContextAction('save')}>
            <Save size={14} aria-hidden /> {t('queue.actions.saveAs', 'Save as Playlist')}
          </button>
        </div>
      )}

      {toast && (
        <div className="queue-sidebar-toast">
          <span>{toast.message}</span>
          {toast.action && toast.actionLabel && (
            <button
              type="button"
              onClick={() => {
                toast.action()
                setToast(null)
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
