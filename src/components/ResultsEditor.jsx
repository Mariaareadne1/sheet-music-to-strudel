import { useState, useCallback, useEffect } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import LZString from 'lz-string'
import InfoBadges from './InfoBadges.jsx'

/**
 * ResultsEditor
 *
 * Shows the generated Strudel code in an editable CodeMirror 6 editor with:
 *   - A thumbnail preview of the uploaded sheet music above the editor
 *   - Metadata badges (title, BPM, time sig, key)
 *   - A prominent "Open in Strudel REPL" button (primary action)
 *   - A "?" tooltip explaining what the REPL button does
 *   - Copy Code and Convert Another buttons
 *
 * Props:
 *   code      – initial Strudel code string
 *   meta      – music metadata from Claude (for InfoBadges)
 *   theme     – 'dark' | 'light' (CodeMirror theme)
 *   thumbnail – base64 JPEG string or null
 *   source    – 'ai' | 'musicxml'  (drives dismissible tip)
 *   onReset   – returns to upload screen
 */
export default function ResultsEditor({ code, meta, theme, thumbnail, source = 'ai', onReset }) {
  const [editorCode,  setEditorCode]  = useState(code)
  const [copied,      setCopied]      = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [tipDismissed, setTipDismissed] = useState(
    () => sessionStorage.getItem('xml_tip_dismissed') === '1'
  )

  const showXmlTip = source === 'ai' && !tipDismissed

  function dismissTip() {
    sessionStorage.setItem('xml_tip_dismissed', '1')
    setTipDismissed(true)
  }

  const onChange = useCallback(val => setEditorCode(val), [])

  /**
   * Encodes the editor content with LZString and opens it in Strudel REPL.
   *
   * Strudel's hash decoder uses LZString.decompressFromEncodedURIComponent()
   * so we must use the matching compressor.  Plain btoa would produce URLs
   * that Strudel cannot decode.
   */
  function openInStrudel() {
    const encoded = LZString.compressToEncodedURIComponent(editorCode)
    window.open(`https://strudel.cc/#${encoded}`, '_blank', 'noopener,noreferrer')
  }

  /** Writes editor content to the clipboard with a textarea fallback. */
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(editorCode)
    } catch {
      const el = document.createElement('textarea')
      el.value = editorCode
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const cmTheme = theme === 'dark' ? oneDark : undefined

  return (
    <div className="w-full max-w-4xl space-y-4 px-2 sm:px-0">

      {/* ── Top row: heading + back button ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <h2 className="font-mono text-sm sm:text-base" style={{ color: 'var(--accent)' }}>
          // Strudel code generated
        </h2>
        <button
          onClick={onReset}
          className="text-xs font-mono px-3 py-1.5 rounded border transition-colors self-start flex-shrink-0"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
          onMouseOut={e =>  { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          ← Convert Another
        </button>
      </div>

      {/* ── Thumbnail + metadata ─────────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        {thumbnail && (
          <div
            className="flex-shrink-0 rounded-lg overflow-hidden"
            style={{
              width:  '100px',
              height: '65px',
              border: '1px solid var(--border)',
            }}
          >
            <img
              src={`data:image/jpeg;base64,${thumbnail}`}
              alt="Uploaded sheet music"
              className="w-full h-full object-cover"
              style={{ opacity: 0.85 }}
            />
          </div>
        )}
        <div className="flex-1 space-y-2 min-w-0">
          <InfoBadges meta={meta} />
        </div>
      </div>

      {/* ── CodeMirror editor ─────────────────────────────────────────────── */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <CodeMirror
          value={editorCode}
          extensions={[javascript()]}
          theme={cmTheme}
          onChange={onChange}
          basicSetup={{
            lineNumbers:             true,
            foldGutter:              false,
            dropCursor:              false,
            allowMultipleSelections: false,
            indentOnInput:           true,
          }}
          style={{ fontSize: '13px' }}
        />
      </div>

      {/* ── Action buttons ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Primary CTA — most important button on the page */}
        <div className="relative flex items-center gap-2">
          <button
            onClick={openInStrudel}
            className="flex items-center gap-2 px-5 sm:px-6 py-3 rounded-lg font-mono text-sm font-bold transition-all shadow-lg"
            style={{
              background:  'var(--accent)',
              color:        '#0f0f0f',
              boxShadow:    '0 0 20px var(--accent-muted)',
              fontSize:     '14px',
              letterSpacing: '0.02em',
            }}
            onMouseOver={e => {
              e.currentTarget.style.background  = 'var(--accent-hover)'
              e.currentTarget.style.boxShadow   = '0 0 30px var(--accent-border)'
              e.currentTarget.style.transform   = 'translateY(-1px)'
            }}
            onMouseOut={e => {
              e.currentTarget.style.background  = 'var(--accent)'
              e.currentTarget.style.boxShadow   = '0 0 20px var(--accent-muted)'
              e.currentTarget.style.transform   = 'translateY(0)'
            }}
          >
            <span>▶</span> Open in Strudel REPL
          </button>

          {/* "?" tooltip trigger */}
          <div className="relative">
            <button
              className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
              style={{
                background: 'var(--surface-raised)',
                border:     '1px solid var(--border-subtle)',
                color:      'var(--text-secondary)',
                cursor:     'help',
              }}
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              onFocus={() => setShowTooltip(true)}
              onBlur={() => setShowTooltip(false)}
              aria-label="What is Strudel REPL?"
            >
              ?
            </button>
            {showTooltip && (
              <div
                className="absolute left-0 bottom-7 z-10 rounded-lg p-3 text-xs font-mono leading-relaxed shadow-xl"
                style={{
                  width:      '220px',
                  background: 'var(--surface)',
                  border:     '1px solid var(--border)',
                  color:      'var(--text-primary)',
                }}
              >
                Opens your code in the Strudel live coding environment at strudel.cc — play, edit, and perform your transcription in real time.
              </div>
            )}
          </div>
        </div>

        {/* Copy Code */}
        <button
          onClick={copyCode}
          className="flex items-center gap-2 px-5 py-3 rounded-lg font-mono text-sm border transition-all"
          style={{
            borderColor: copied ? '#4ade80' : 'var(--border-subtle)',
            color:        copied ? '#4ade80' : 'var(--text-secondary)',
            background:   'transparent',
          }}
          onMouseOver={e => {
            if (!copied) {
              e.currentTarget.style.borderColor = 'var(--accent)'
              e.currentTarget.style.color = 'var(--accent)'
            }
          }}
          onMouseOut={e => {
            if (!copied) {
              e.currentTarget.style.borderColor = 'var(--border-subtle)'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }
          }}
        >
          {copied ? '✓ Copied!' : '⎘ Copy Code'}
        </button>
      </div>

      <p className="text-xs font-mono" style={{ color: 'var(--text-dim)' }}>
        // Editor is fully editable — tweak the code before opening in Strudel
      </p>

      {/* ── Dismissible MusicXML tip (AI path only, once per session) ───────── */}
      {showXmlTip && (
        <div
          className="flex items-start gap-3 rounded-lg px-4 py-3"
          style={{
            background:  'rgba(250, 204, 21, 0.07)',
            border:      '1px solid rgba(250, 204, 21, 0.22)',
          }}
        >
          <span className="flex-shrink-0 text-sm mt-0.5">💡</span>
          <p className="flex-1 text-xs font-mono leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            For better accuracy, try downloading the MusicXML version of this piece from{' '}
            <span style={{ color: '#facc15' }}>musescore.com</span> and re-uploading it.
          </p>
          <button
            onClick={dismissTip}
            className="flex-shrink-0 text-xs font-mono leading-none"
            style={{ color: 'var(--text-dim)', cursor: 'pointer' }}
            aria-label="Dismiss tip"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
