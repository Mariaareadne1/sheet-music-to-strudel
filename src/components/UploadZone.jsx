import { useState, useRef } from 'react'

const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']

export default function UploadZone({ onFile }) {
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef(null)

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && ACCEPTED.includes(file.type)) {
      onFile(file)
    }
  }

  function handleChange(e) {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div className="w-full max-w-2xl space-y-8">
      <div className="text-center space-y-3">
        <h1
          className="text-4xl font-bold tracking-tight"
          style={{ color: '#ff69b4', fontFamily: 'JetBrains Mono, monospace' }}
        >
          Sheet Music → Strudel
        </h1>
        <p className="text-gray-400 text-sm font-mono">
          Upload a PDF or image of sheet music. Claude reads it.<br />
          You get live-coding code. Ready to play.
        </p>
      </div>

      <div
        className={`relative border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all duration-200 ${
          dragging ? 'drag-over' : ''
        }`}
        style={{
          borderColor: dragging || hovered ? '#ff69b4' : '#2a2a2a',
          background: dragging
            ? 'rgba(255,105,180,0.05)'
            : hovered
            ? 'rgba(255,105,180,0.03)'
            : '#111111',
        }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={handleChange}
        />

        <div className="space-y-4 pointer-events-none">
          <div className="text-6xl">🎼</div>
          <div>
            <p className="text-gray-200 font-mono text-lg font-medium">
              Drop your sheet music here
            </p>
            <p className="text-gray-500 font-mono text-sm mt-1">
              or click to browse
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs font-mono">
            {['PDF', 'PNG', 'JPG', 'WEBP'].map(fmt => (
              <span
                key={fmt}
                className="px-2 py-1 rounded"
                style={{ background: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a' }}
              >
                {fmt}
              </span>
            ))}
          </div>
        </div>

        {dragging && (
          <div
            className="absolute inset-0 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,105,180,0.08)' }}
          >
            <p className="font-mono text-lg" style={{ color: '#ff69b4' }}>
              Release to upload
            </p>
          </div>
        )}
      </div>

      <div className="border border-gray-800 rounded-lg p-4 space-y-2">
        <p className="text-gray-600 text-xs font-mono uppercase tracking-widest">How it works</p>
        <div className="space-y-1">
          {[
            '1. Upload sheet music (multi-page PDFs supported)',
            '2. Claude AI reads every note, rhythm, and voice',
            '3. Get Strudel live-coding code, ready to play',
          ].map(step => (
            <p key={step} className="text-gray-500 text-xs font-mono">{step}</p>
          ))}
        </div>
      </div>
    </div>
  )
}
