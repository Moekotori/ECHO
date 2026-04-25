import React, { useState } from 'react'
import { ChevronDown, FolderOpen, Trash2 } from 'lucide-react'

export default function ImportedFolderRail({
  folders = [],
  activeFolder = '',
  title = 'Imported folders',
  emptyLabel = 'No imported folders',
  openLabel = 'Open folder',
  removeLabel = 'Remove folder',
  onOpen,
  onRemove
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`imported-folder-rail${expanded ? ' is-open' : ' is-collapsed'}`} aria-label={title}>
      <button
        type="button"
        className="imported-folder-rail-title"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span>{title}</span>
        <ChevronDown size={14} className="imported-folder-rail-caret" aria-hidden />
      </button>
      {expanded && folders.length > 0 ? (
        <div className="imported-folder-rail-list">
          {folders.map((folder) => (
            <div
              key={folder.path}
              className={`imported-folder-rail-item${activeFolder === folder.path ? ' active' : ''}`}
            >
              <button
                type="button"
                className="imported-folder-rail-open"
                onClick={() => onOpen?.(folder)}
                title={folder.path}
                aria-label={`${openLabel}: ${folder.name}`}
              >
                <FolderOpen size={14} aria-hidden />
                <span className="imported-folder-rail-name">{folder.name}</span>
                <span className="imported-folder-rail-count">{folder.trackCount}</span>
              </button>
              <button
                type="button"
                className="imported-folder-rail-remove"
                onClick={(event) => {
                  event.stopPropagation()
                  onRemove?.(folder)
                }}
                title={removeLabel}
                aria-label={`${removeLabel}: ${folder.name}`}
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : expanded ? (
        <div className="imported-folder-rail-empty">{emptyLabel}</div>
      ) : null}
    </div>
  )
}
