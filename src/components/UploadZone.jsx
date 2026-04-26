import { useState, useRef } from 'react'

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']

/**
 * UploadZone
 *
 * Full-page drag-and-drop area plus a click-to-browse fallback.
 * Calls onFile(file) as soon as a valid file is selected or dropped.
 * Rejects unrecognised MIME types silently (browser file picker already filters).
 */
export default function UploadZone({ onFile }) {
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered]   = useState(false)
  const inputRef = useRef(null)

  /** Handle the file from a drag-and-drop event. */
  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && ACCEPTED_TYPES.includes(file.type)) {
      onFile(file)
    }
  }

  /** Handle the file from the hidden <input type="file"> picker. */
  function handleChange(e) {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }

  // Compute drop zone border/background based on interaction state
  const zoneStyle = {
    borderColor:     dragging || hovered ? 'var(--accent)'   : 'var(--border)',
    background:      dragging            ? 'var(--accent-muted)'
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
          Upload a PDF or image of sheet music. Claude reads it.<br />
          You get live-coding code. Ready to play.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className="relative border-2 border-dashed rounded-xl p-8 sm:p-16 text-center cursor-pointer"
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
        {/* Hidden native file input */}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={handleChange}
        />

        {/* Content (pointer-events disabled so clicks pass through to the div) */}
        <div className="space-y-4 pointer-events-none">
          <div className="text-5xl sm:text-6xl">🎼</div>
          <div>
            <p className="font-mono text-base sm:text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
              Drop your sheet music here
            </p>
            <p className="font-mono text-xs sm:text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              or click to browse
            </p>
          </div>

          {/* Accepted format badges */}
          <div className="flex items-center justify-center gap-2 text-xs font-mono flex-wrap">
            {['PDF', 'PNG', 'JPG', 'WEBP'].map(fmt => (
              <span
                key={fmt}
                className="px-2 py-1 rounded"
                style={{
                  background: 'var(--surface-raised)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}
              >
                {fmt}
              </span>
            ))}
          </div>
        </div>

        {/* Overlay shown while a file is being dragged over the zone */}
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

      {/* "How it works" info card */}
      <div
        className="rounded-lg p-4 space-y-2"
        style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        <p
          className="text-xs font-mono uppercase tracking-widest"
          style={{ color: 'var(--text-dim)' }}
        >
          How it works
        </p>
        <div className="space-y-1">
          {[
            '1. Upload sheet music (multi-page PDFs supported)',
            '2. Claude AI reads every note, rhythm, and voice',
            '3. Get Strudel live-coding code, ready to play',
          ].map(step => (
            <p key={step} className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              {step}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
