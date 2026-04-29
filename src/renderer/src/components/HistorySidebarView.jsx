import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock3,
  History,
  ListMusic,
  Play,
  RotateCcw,
  Search,
  StepBack,
  Trash2,
  X
} from 'lucide-react'

const BUCKET_ORDER = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'earlier']

function getEntryKey(entry) {
  return `${entry?.path || 'history'}::${Number(entry?.historyIndex) || 0}`
}

function matchesEntry(entry, query) {
  if (!query) return true
  const haystack = [entry?.title, entry?.artist, entry?.album].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(query)
}

function getInitials(title) {
  const source = String(title || '').trim()
  if (!source) return 'E'
  const compact = source.replace(/^\W+/, '')
  return (compact || source).slice(0, 2).toUpperCase()
}

const HistoryRow = memo(function HistoryRow({
  entry,
  selected,
  onSelect,
  onPlay,
  onJump,
  onRemove
}) {
  const { t } = useTranslation()
  const disabledJumpTitle = entry.inCurrentPlaylist
    ? t('history.actionJump', 'Jump in playlist')
    : t('history.actionJumpDisabled', 'This track is not in the current playlist')

  return (
    <div
      className={`history-sidebar-item${selected ? ' history-sidebar-item--selected' : ''}`}
      tabIndex={selected ? 0 : -1}
      data-history-key={getEntryKey(entry)}
      onClick={() => onSelect(entry)}
      onDoubleClick={() => onPlay(entry)}
      title={`${entry.title} - ${entry.artist || t('track.unknownArtist', 'Unknown Artist')}`}
    >
      <div className="history-sidebar-cover" aria-hidden>
        {entry.cover ? (
          <img src={entry.cover} alt="" draggable={false} />
        ) : (
          <span>{getInitials(entry.title)}</span>
        )}
      </div>
      <div className="history-sidebar-item-main">
        <div className="history-sidebar-item-title">{entry.title}</div>
        <div className="history-sidebar-item-subtitle">
          {[entry.artist, entry.album].filter(Boolean).join(' - ') ||
            t('track.unknownArtist', 'Unknown Artist')}
        </div>
      </div>
      <div className="history-sidebar-item-meta">
        <span>{entry.relativeTime}</span>
        {entry.playCount > 0 && (
          <strong>
            {t('history.playCount', {
              count: entry.playCount,
              defaultValue: 'x{{count}}'
            })}
          </strong>
        )}
      </div>
      <div className="history-sidebar-row-actions">
        <button
          type="button"
          className="history-sidebar-row-action"
          title={t('history.actionPlay', 'Play')}
          onClick={(event) => {
            event.stopPropagation()
            onPlay(entry)
          }}
        >
          <Play size={14} />
        </button>
        <button
          type="button"
          className="history-sidebar-row-action"
          title={disabledJumpTitle}
          disabled={!entry.inCurrentPlaylist}
          onClick={(event) => {
            event.stopPropagation()
            if (entry.inCurrentPlaylist) onJump(entry)
          }}
        >
          <StepBack size={14} />
        </button>
        <button
          type="button"
          className="history-sidebar-row-action history-sidebar-row-action--danger"
          title={t('history.actionRemove', 'Remove from history')}
          onClick={(event) => {
            event.stopPropagation()
            onRemove(entry)
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
})

export default function HistorySidebarView({
  entries,
  canBack,
  onBack,
  onClear,
  onPlay,
  onJump,
  onRemove
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sortMode, setSortMode] = useState('time')
  const [selectedKey, setSelectedKey] = useState('')
  const searchRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200)
    return () => window.clearTimeout(timer)
  }, [query])

  const visibleEntries = useMemo(() => {
    const filtered = (Array.isArray(entries) ? entries : []).filter((entry) =>
      matchesEntry(entry, debouncedQuery)
    )
    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'playCount') {
        const countDelta = Number(b.playCount || 0) - Number(a.playCount || 0)
        if (countDelta) return countDelta
      }
      const timeDelta = Number(b.playedAt || 0) - Number(a.playedAt || 0)
      if (timeDelta) return timeDelta
      return Number(b.historyIndex || 0) - Number(a.historyIndex || 0)
    })
    return sorted
  }, [debouncedQuery, entries, sortMode])

  const groupedEntries = useMemo(() => {
    const groups = new Map(BUCKET_ORDER.map((bucket) => [bucket, []]))
    for (const entry of visibleEntries) {
      const bucket = BUCKET_ORDER.includes(entry.bucket) ? entry.bucket : 'earlier'
      groups.get(bucket).push(entry)
    }
    return BUCKET_ORDER.map((bucket) => ({ bucket, items: groups.get(bucket) })).filter(
      (group) => group.items.length > 0
    )
  }, [visibleEntries])

  useEffect(() => {
    if (visibleEntries.length === 0) {
      setSelectedKey('')
      return
    }
    setSelectedKey((prev) =>
      visibleEntries.some((entry) => getEntryKey(entry) === prev) ? prev : getEntryKey(visibleEntries[0])
    )
  }, [visibleEntries])

  const selectedEntry = useMemo(
    () => visibleEntries.find((entry) => getEntryKey(entry) === selectedKey) || null,
    [selectedKey, visibleEntries]
  )

  const selectEntry = useCallback((entry) => {
    setSelectedKey(getEntryKey(entry))
  }, [])

  const removeEntry = useCallback(
    (entry) => {
      onRemove(entry)
    },
    [onRemove]
  )

  const handleClear = useCallback(() => {
    if (!entries.length) return
    const ok = window.confirm(t('history.confirmClear', 'Clear all listening history?'))
    if (ok) onClear()
  }, [entries.length, onClear, t])

  const handleKeyDown = useCallback(
    (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        if (event.key === 'Enter' && selectedEntry) {
          event.preventDefault()
          onPlay(selectedEntry)
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEntry) {
          event.preventDefault()
          removeEntry(selectedEntry)
        }
        return
      }
      event.preventDefault()
      if (visibleEntries.length === 0) return
      const currentIndex = Math.max(
        0,
        visibleEntries.findIndex((entry) => getEntryKey(entry) === selectedKey)
      )
      const nextIndex =
        event.key === 'ArrowDown'
          ? Math.min(visibleEntries.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1)
      const nextEntry = visibleEntries[nextIndex]
      if (!nextEntry) return
      const nextKey = getEntryKey(nextEntry)
      setSelectedKey(nextKey)
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector(`[data-history-key="${CSS.escape(nextKey)}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      })
    },
    [onPlay, removeEntry, selectedEntry, selectedKey, visibleEntries]
  )

  const hasSearch = query.trim().length > 0
  const emptyMessage = hasSearch
    ? t('history.empty.noSearchMatch', {
        query: query.trim(),
        defaultValue: 'No matches for "{{query}}"'
      })
    : t('history.empty.noHistory', "Once you start playing tracks, they'll show up here.")

  return (
    <section className="history-sidebar-view" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="history-sidebar-header no-drag">
        <div>
          <div className="history-sidebar-title">
            <History size={17} aria-hidden />
            {t('history.title', 'Listening history')}
          </div>
          <div className="history-sidebar-subtitle">
            {t('history.totalCount', {
              count: entries.length,
              defaultValue: '{{count}} tracks'
            })}
          </div>
        </div>
        <div className="history-sidebar-actions">
          <button
            type="button"
            className="history-sidebar-action"
            onClick={onBack}
            title={t('history.backOneStep', 'Back one step')}
            disabled={!canBack}
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            className="history-sidebar-action history-sidebar-action--danger"
            onClick={handleClear}
            title={t('queue.actions.clear', 'Clear')}
            disabled={entries.length === 0}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="history-sidebar-toolbar no-drag">
        <div className="history-sidebar-search">
          <Search size={14} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('history.searchPlaceholder', 'Search title / artist / album...')}
          />
          {query.trim() && (
            <button type="button" onClick={() => setQuery('')} aria-label={t('common.clear', 'Clear')}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="history-sidebar-sort" role="group" aria-label={t('history.sort', 'Sort history')}>
          <button
            type="button"
            className={sortMode === 'time' ? 'active' : ''}
            onClick={() => setSortMode('time')}
          >
            <Clock3 size={13} />
            {t('history.sortByTime', 'By time')}
          </button>
          <button
            type="button"
            className={sortMode === 'playCount' ? 'active' : ''}
            onClick={() => setSortMode('playCount')}
          >
            <ListMusic size={13} />
            {t('history.sortByPlayCount', 'By play count')}
          </button>
        </div>
      </div>

      {visibleEntries.length === 0 ? (
        <div className="history-sidebar-empty">
          <History size={72} />
          <p className="app-empty-state__title">{emptyMessage}</p>
          {hasSearch && (
            <button type="button" className="history-sidebar-empty-clear" onClick={() => setQuery('')}>
              {t('common.clear', 'Clear')}
            </button>
          )}
        </div>
      ) : (
        <div ref={listRef} className="history-sidebar-list">
          {groupedEntries.map((group) => (
            <section key={group.bucket} className="history-sidebar-group">
              <div className="history-sidebar-group-title">
                {t(`history.bucket.${group.bucket}`, group.bucket)}
              </div>
              <div className="history-sidebar-group-items">
                {group.items.map((entry) => (
                  <HistoryRow
                    key={getEntryKey(entry)}
                    entry={entry}
                    selected={selectedKey === getEntryKey(entry)}
                    onSelect={selectEntry}
                    onPlay={onPlay}
                    onJump={onJump}
                    onRemove={removeEntry}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
