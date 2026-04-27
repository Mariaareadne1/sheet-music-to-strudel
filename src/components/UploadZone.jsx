import { useState, useRef } from 'react'

const XML_TYPES  = new Set([
  'application/xml', 'text/xml',
  'application/vnd.recordare.musicxml',
  'application/vnd.recordare.musicxml+xml',
])
const IMAGE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])

function isAccepted(file) {
  if (!file) return false
  const name = (file.name ?? '').toLowerCase()
  if (name.endsWith('.xml') || name.endsWith('.mxl')) return true
  return IMAGE_TYPES.has(file.type) || XML_TYPES.has(file.type)
}

/**
 * UploadZone
 *
 * Full-page drag-and-drop zone that accepts MusicXML (.xml / .mxl) files for
 * high-accuracy parsing and PDF/image files for AI transcription.
 *
 * Calls onFile(file) as soon as a valid file is selected or dropped.
 */
export default function UploadZone({ onFile }) {
  const [dragging,     setDragging]     = useState(false)
  const [hovered,      setHovered]      = useState(false)
  const [showTooltip,  setShowTooltip]  = useState(false)
  const inputRef = useRef(null)

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && isAccepted(file)) onFile(file)
  }

  function handleChange(e) {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }

  const zoneStyle = {
    borderColor: dragging || hovered ? 'var(--accent)' : 'var(--border)',
    background:  dragging            ? 'var(--accent-muted)'
               : hovered             ? 'rgba(0,0,0,0.02)'
               : 'var(--surface)',
    transition: 'border-color 0.15s, background 0.15s',
  }

  return (
    <div className="w-full max-w-2xl space-y-6 sm:space-y-8 px-2 sm:px-0">

      {/* Hero heading */}
      <div className="text-center space-y-3">
        <h1
          className="text-3xl sm:text-4xl font-bold tracking-tight"
          style={{ color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}
        >
          Sheet Music → Strudel
        </h1>
        <p className="font-mono text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
          Upload sheet music. Get live-coding code. Ready to play.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className="relative border-2 border-dashed rounded-xl p-8 sm:p-14 text-center cursor-pointer"
        style={zoneStyle}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        role="button"
        aria-label="Upload sheet music"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml,.mxl,.pdf,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={handleChange}
        />

        <div className="space-y-5 pointer-events-none">
          <div className="text-5xl sm:text-6xl">🎼</div>

          {/* Main label */}
          <div>
            <p className="font-mono text-base sm:text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
              Drop sheet music here
            </p>
            <p className="font-mono text-xs sm:text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              or click to browse
            </p>
          </div>

          {/* Two-mode legend */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-xs font-mono">
            {/* XML / MXL — high accuracy */}
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.25)' }}
            >
              <span
                className="px-1.5 py-0.5 rounded text-xs font-bold"
                style={{ background: 'rgba(74, 222, 128, 0.2)', color: '#4ade80' }}
              >
                HIGH ACCURACY
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>XML / MXL</span>
            </div>

            <span className="hidden sm:block" style={{ color: 'var(--text-dim)' }}>·</span>

            {/* PDF / Image — AI vision */}
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: 'rgba(250, 204, 21, 0.07)', border: '1px solid rgba(250, 204, 21, 0.2)' }}
            >
              <span
                className="px-1.5 py-0.5 rounded text-xs font-bold"
                style={{ background: 'rgba(250, 204, 21, 0.15)', color: '#facc15' }}
              >
                AI VISION
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>PDF / PNG / JPG</span>
            </div>
          </div>

          {/* Format badges row */}
          <div className="flex items-center justify-center gap-2 text-xs font-mono flex-wrap">
            {[
              { fmt: 'MXL',  accent: '#4ade80' },
              { fmt: 'XML',  accent: '#4ade80' },
              { fmt: 'PDF',  accent: 'var(--text-secondary)' },
              { fmt: 'PNG',  accent: 'var(--text-secondary)' },
              { fmt: 'JPG',  accent: 'var(--text-secondary)' },
            ].map(({ fmt, accent }) => (
              <span
                key={fmt}
                className="px-2 py-1 rounded"
                style={{
                  background: 'var(--surface-raised)',
                  color:       accent,
                  border:     '1px solid var(--border)',
                }}
              >
                {fmt}
              </span>
            ))}
          </div>
        </div>

        {/* Drag-over overlay */}
        {dragging && (
          <div
            className="absolute inset-0 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--accent-muted)' }}
          >
            <p className="font-mono text-base sm:text-lg" style={{ color: 'var(--accent)' }}>
              Release to upload
            </p>
          </div>
        )}
      </div>

      {/* Info card with tooltip trigger */}
      <div
        className="rounded-lg p-4 space-y-3"
        style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        {/* Section header */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
            How it works
          </p>

          {/* MusicXML tip tooltip trigger */}
          <div className="relative">
            <button
              className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded transition-colors"
              style={{
                background: 'rgba(74, 222, 128, 0.08)',
                border:     '1px solid rgba(74, 222, 128, 0.2)',
                color:      '#4ade80',
                cursor:     'pointer',
              }}
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              onFocus={() => setShowTooltip(true)}
              onBlur={() => setShowTooltip(false)}
              onClick={e => e.stopPropagation()}
              aria-label="How to get MusicXML files"
            >
              💡 Get MusicXML free
            </button>

            {showTooltip && (
              <div
                className="absolute right-0 bottom-8 z-10 rounded-lg p-3 text-xs font-mono leading-relaxed shadow-xl"
                style={{
                  width:      '260px',
                  background: 'var(--surface)',
                  border:     '1px solid var(--border)',
                  color:      'var(--text-primary)',
                }}
              >
                <p style={{ color: '#4ade80', fontWeight: 'bold', marginBottom: '4px' }}>
                  💡 Free MusicXML files
                </p>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Download .mxl files for most songs at{' '}
                  <span style={{ color: '#4ade80' }}>musescore.com</span>.
                  MusicXML gives perfect note accuracy — no AI guessing.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <span style={{ color: '#4ade80', flexShrink: 0 }} className="text-xs font-mono mt-0.5">✓</span>
            <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ color: '#4ade80' }}>MusicXML / MXL</span> — parsed directly, perfect accuracy
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span style={{ color: '#facc15', flexShrink: 0 }} className="text-xs font-mono mt-0.5">~</span>
            <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ color: '#facc15' }}>PDF / Image</span> — Claude AI reads every note and rhythm
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span style={{ color: 'var(--accent)', flexShrink: 0 }} className="text-xs font-mono mt-0.5">→</span>
            <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              Get Strudel live-coding code, ready to play in strudel.cc
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
