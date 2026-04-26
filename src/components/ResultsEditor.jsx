import { useState, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import InfoBadges from './InfoBadges.jsx'

export default function ResultsEditor({ code, meta, onReset }) {
  const [editorCode, setEditorCode] = useState(code)
  const [copied, setCopied] = useState(false)

  const onChange = useCallback(val => setEditorCode(val), [])

  function openInStrudel() {
    const encoded = btoa(unescape(encodeURIComponent(editorCode)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    window.open(`https://strudel.cc/#${encoded}`, '_blank', 'noopener,noreferrer')
  }

  async function copyCode() {
    await navigator.clipboard.writeText(editorCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="w-full max-w-4xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-mono text-lg" style={{ color: '#ff69b4' }}>
            // Strudel code generated
          </h2>
          <InfoBadges meta={meta} />
        </div>
        <button
          onClick={onReset}
          className="text-xs font-mono px-3 py-1.5 rounded border transition-colors self-start sm:self-auto"
          style={{ borderColor: '#333', color: '#888' }}
          onMouseOver={e => { e.target.style.borderColor = '#ff69b4'; e.target.style.color = '#ff69b4' }}
          onMouseOut={e => { e.target.style.borderColor = '#333'; e.target.style.color = '#888' }}
        >
          ← Convert Another
        </button>
      </div>

      <div className="rounded-xl overflow-hidden border border-gray-800">
        <CodeMirror
          value={editorCode}
          extensions={[javascript()]}
          theme={oneDark}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            dropCursor: false,
            allowMultipleSelections: false,
            indentOnInput: true,
          }}
          style={{ fontSize: '14px' }}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={openInStrudel}
          className="flex items-center gap-2 px-5 py-2.5 rounded font-mono text-sm font-medium transition-all"
          style={{
            background: '#ff69b4',
            color: '#0f0f0f',
          }}
          onMouseOver={e => { e.currentTarget.style.background = '#ff85c2' }}
          onMouseOut={e => { e.currentTarget.style.background = '#ff69b4' }}
        >
          <span>▶</span> Open in Strudel REPL
        </button>

        <button
          onClick={copyCode}
          className="flex items-center gap-2 px-5 py-2.5 rounded font-mono text-sm border transition-all"
          style={{
            borderColor: copied ? '#4ade80' : '#ff69b4',
            color: copied ? '#4ade80' : '#ff69b4',
            background: 'transparent',
          }}
        >
          {copied ? '✓ Copied!' : '⎘ Copy Code'}
        </button>
      </div>

      <p className="text-gray-600 text-xs font-mono">
        // The editor is fully editable — tweak the code before opening in Strudel
      </p>
    </div>
  )
}
