import { useState, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import LZString from 'lz-string'
import InfoBadges from './InfoBadges.jsx'

/**
 * ResultsEditor
 *
 * Shows the generated Strudel code in an editable CodeMirror 6 editor and
 * provides three action buttons:
 *   – Open in Strudel REPL  (encodes with lz-string, the format Strudel expects)
 *   – Copy Code             (writes to clipboard)
 *   – Convert Another       (calls onReset to go back to the upload screen)
 *
 * Props:
 *   code    – initial Strudel code string from the compiler
 *   meta    – raw JSON returned by Claude (for InfoBadges)
 *   theme   – 'dark' | 'light' (controls CodeMirror theme)
 *   onReset – callback to return to the upload screen
 */
export default function ResultsEditor({ code, meta, theme, onReset }) {
  const [editorCode, setEditorCode] = useState(code)
  const [copied, setCopied]         = useState(false)

  const onChange = useCallback(val => setEditorCode(val), [])

  /**
   * Encodes the current editor content and opens it in the Strudel REPL.
   *
   * Strudel's REPL (strudel.cc) decodes its URL hash using
   * LZString.decompressFromEncodedURIComponent(), so we must use the matching
   * compressor rather than plain btoa.  The lz-string library produces a
   * compact, URL-safe string that also works for long pieces.
   */
  function openInStrudel() {
    const encoded = LZString.compressToEncodedURIComponent(editorCode)
    window.open(`https://strudel.cc/#${encoded}`, '_blank', 'noopener,noreferrer')
  }

  /** Writes the current editor content to the system clipboard. */
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(editorCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for browsers that block clipboard without HTTPS
      const el = document.createElement('textarea')
      el.value = editorCode
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Apply the one-dark theme only in dark mode; use CodeMirror's default light
  // theme otherwise so the editor matches the rest of the UI.
  const cmTheme = theme === 'dark' ? oneDark : undefined

  return (
    <div className="w-full max-w-4xl space-y-4 px-2 sm:px-0">

      {/* Header row: title + metadata badges + back button */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <h2 className="font-mono text-base sm:text-lg" style={{ color: 'var(--accent)' }}>
            // Strudel code generated
          </h2>
          <InfoBadges meta={meta} />
        </div>

        <button
          onClick={onReset}
          className="text-xs font-mono px-3 py-1.5 rounded border transition-colors self-start flex-shrink-0"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          onMouseOver={e => {
            e.currentTarget.style.borderColor = 'var(--accent)'
            e.currentTarget.style.color = 'var(--accent)'
          }}
          onMouseOut={e => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
        >
          ← Convert Another
        </button>
      </div>

      {/* CodeMirror editor */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border)' }}
      >
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

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        {/* Primary CTA: opens Strudel REPL in a new tab */}
        <button
          onClick={openInStrudel}
          className="flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded font-mono text-xs sm:text-sm font-medium transition-all"
          style={{ background: 'var(--accent)', color: '#0f0f0f' }}
          onMouseOver={e => { e.currentTarget.style.background = 'var(--accent-hover)' }}
          onMouseOut={e =>  { e.currentTarget.style.background = 'var(--accent)' }}
        >
          <span>▶</span> Open in Strudel REPL
        </button>

        {/* Secondary: copy to clipboard */}
        <button
          onClick={copyCode}
          className="flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded font-mono text-xs sm:text-sm border transition-all"
          style={{
            borderColor: copied ? '#4ade80' : 'var(--accent)',
            color:        copied ? '#4ade80' : 'var(--accent)',
            background:   'transparent',
          }}
        >
          {copied ? '✓ Copied!' : '⎘ Copy Code'}
        </button>
      </div>

      <p className="text-xs font-mono" style={{ color: 'var(--text-dim)' }}>
        // The editor is fully editable — tweak the code before opening in Strudel
      </p>
    </div>
  )
}
