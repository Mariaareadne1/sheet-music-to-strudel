import { useState, useEffect } from 'react'
import {
  getHistory,
  deleteHistoryEntry,
  clearHistory,
  formatTimestamp,
} from '../lib/history.js'

/**
 * HistoryDrawer
 *
 * A slide-in panel from the right that shows every past conversion saved in
 * localStorage.  Each card includes a thumbnail, title, BPM badge, and
 * relative timestamp.
 *
 * Props:
 *   isOpen   – controls visibility / slide direction
 *   onClose  – callback to close the drawer
 *   onLoad   – callback(entry) to load a saved code entry into the editor
 */
export default function HistoryDrawer({ isOpen, onClose, onLoad }) {
  const [entries, setEntries] = useState([])

  // Reload history from localStorage every time the drawer opens
  useEffect(() => {
    if (isOpen) setEntries(getHistory())
  }, [isOpen])

  function handleDelete(id) {
    setEntries(deleteHistoryEntry(id))
  }

  function handleClearAll() {
    setEntries(clearHistory())
  }

  function handleLoad(entry) {
    onLoad(entry)
    onClose()
  }

  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
          onClick={onClose}
        />
      )}

      {/* ── Drawer panel ──────────────────────────────────────────────────── */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width:      '340px',
          maxWidth:   '100vw',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          transform:  isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          overflowY:  'auto',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="font-mono text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            🕐 Conversion History
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded text-xs transition-colors"
            style={{ color: 'var(--text-secondary)', background: 'var(--surface-raised)' }}
            aria-label="Close history drawer"
          >
            ✕
          </button>
        </div>

        {/* Entry list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {entries.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <p className="text-3xl">🎵</p>
              <p className="font-mono text-xs" style={{ color: 'var(--text-dim)' }}>
                No conversions yet.<br />Upload some sheet music to get started.
              </p>
            </div>
          ) : (
            entries.map(entry => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                onLoad={handleLoad}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>

        {/* Footer */}
        {entries.length > 0 && (
          <div
            className="flex-shrink-0 px-4 py-3"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <button
              onClick={handleClearAll}
              className="w-full py-2 rounded font-mono text-xs border transition-colors"
              style={{
                borderColor: 'var(--error-border)',
                color:       'var(--error-text)',
                background:  'transparent',
              }}
              onMouseOver={e => { e.currentTarget.style.background = 'var(--error-bg)' }}
              onMouseOut={e =>  { e.currentTarget.style.background = 'transparent' }}
            >
              Clear All History
            </button>
          </div>
        )}
      </div>
    </>
  )
}

/**
 * HistoryCard — displays one history entry with thumbnail, metadata, and
 * Load / Delete action buttons.
 */
function HistoryCard({ entry, onLoad, onDelete }) {
  const { id, title, bpm, timeSignature, key, thumbnail, timestamp } = entry
  const tsLabel = Array.isArray(timeSignature)
    ? `${timeSignature[0]}/${timeSignature[1]}`
    : '4/4'

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--border)', background: 'var(--surface-raised)' }}
    >
      {/* Thumbnail */}
      {thumbnail ? (
        <div className="relative" style={{ height: 80 }}>
          <img
            src={`data:image/jpeg;base64,${thumbnail}`}
            alt="Sheet music preview"
            className="w-full h-full object-cover"
            style={{ opacity: 0.85 }}
          />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, transparent 50%, var(--surface-raised))' }}
          />
        </div>
      ) : (
        <div
          className="flex items-center justify-center text-2xl"
          style={{ height: 80, background: 'var(--border)', color: 'var(--text-dim)' }}
        >
          🎼
        </div>
      )}

      {/* Card body */}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p
            className="font-mono text-xs font-semibold leading-tight truncate"
            style={{ color: 'var(--text-primary)', maxWidth: '80%' }}
            title={title}
          >
            {title || 'Unknown'}
          </p>
          {/* Delete button */}
          <button
            onClick={() => onDelete(id)}
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs transition-colors"
            style={{ color: 'var(--text-dim)', background: 'var(--border)' }}
            title="Delete entry"
            onMouseOver={e => { e.currentTarget.style.color = 'var(--error-text)' }}
            onMouseOut={e =>  { e.currentTarget.style.color = 'var(--text-dim)' }}
            aria-label="Delete history entry"
          >
            ×
          </button>
        </div>

        {/* Metadata badges */}
        <div className="flex flex-wrap gap-1">
          {[
            bpm && `${bpm} bpm`,
            tsLabel,
            key,
          ].filter(Boolean).map(label => (
            <span
              key={label}
              className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{
                background: 'var(--accent-muted)',
                color:      'var(--accent)',
                border:     '1px solid var(--accent-border)',
              }}
            >
              {label}
            </span>
          ))}
          <span className="px-1.5 py-0.5 rounded text-xs font-mono ml-auto"
            style={{ color: 'var(--text-dim)' }}>
            {formatTimestamp(timestamp)}
          </span>
        </div>

        {/* Load button */}
        <button
          onClick={() => onLoad(entry)}
          className="w-full py-1.5 rounded font-mono text-xs font-medium transition-all"
          style={{ background: 'var(--accent)', color: '#0f0f0f' }}
          onMouseOver={e => { e.currentTarget.style.background = 'var(--accent-hover)' }}
          onMouseOut={e =>  { e.currentTarget.style.background = 'var(--accent)' }}
        >
          Load
        </button>
      </div>
    </div>
  )
}
