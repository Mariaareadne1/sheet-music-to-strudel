import { useState, useEffect } from 'react'
import UploadZone from './components/UploadZone.jsx'
import ProcessingScreen from './components/ProcessingScreen.jsx'
import ResultsEditor from './components/ResultsEditor.jsx'
import { pdfToImages } from './lib/pdfToImages.js'
import { callClaudeAPI } from './lib/claudeApi.js'
import { compileToStrudel } from './lib/strudelCompiler.js'

const STAGES = {
  UPLOAD: 'upload',
  PROCESSING: 'processing',
  RESULTS: 'results',
  ERROR: 'error',
}

/**
 * Root application component.
 *
 * Owns the top-level state machine (upload → processing → results / error),
 * the dark/light theme preference, and the step-by-step progress counter that
 * gets passed down to ProcessingScreen.
 */
export default function App() {
  const [stage, setStage]       = useState(STAGES.UPLOAD)
  const [statusMsg, setStatusMsg] = useState('')
  const [progress, setProgress]  = useState(0)
  const [result, setResult]      = useState(null)
  const [error, setError]        = useState(null)

  // Theme preference: persisted in localStorage so it survives page reloads.
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') ?? 'dark'
  })

  // Sync the data-theme attribute on the root element whenever theme changes.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }

  /**
   * Orchestrates the full file → API → compiler pipeline.
   * Updates progress (0-100) at each milestone so the user sees a live bar.
   */
  async function handleFile(file) {
    setStage(STAGES.PROCESSING)
    setError(null)
    setProgress(5)

    try {
      let images = []

      if (file.type === 'application/pdf') {
        setStatusMsg('Converting PDF pages...')
        images = await pdfToImages(file)
      } else {
        setStatusMsg('Reading image...')
        images = await fileToBase64Images(file)
      }

      setProgress(25)
      setStatusMsg('Reading sheet music...')
      setProgress(30)

      const rawJson = await callClaudeAPI(images)

      setProgress(85)
      setStatusMsg('Identifying notes...')
      await delay(200)

      setProgress(92)
      setStatusMsg('Compiling Strudel pattern...')
      await delay(150)

      const strudelCode = compileToStrudel(rawJson)

      setProgress(100)
      await delay(200)

      setResult({ code: strudelCode, meta: rawJson })
      setStage(STAGES.RESULTS)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong.')
      setStage(STAGES.ERROR)
    }
  }

  /** Resets all state back to the upload screen. */
  function handleReset() {
    setStage(STAGES.UPLOAD)
    setResult(null)
    setError(null)
    setStatusMsg('')
    setProgress(0)
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--bg)', color: 'var(--text-primary)', transition: 'background 0.2s, color 0.2s' }}
    >
      <Header theme={theme} toggleTheme={toggleTheme} />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {stage === STAGES.UPLOAD && (
          <UploadZone onFile={handleFile} />
        )}
        {stage === STAGES.PROCESSING && (
          <ProcessingScreen statusMsg={statusMsg} progress={progress} />
        )}
        {stage === STAGES.RESULTS && result && (
          <ResultsEditor
            code={result.code}
            meta={result.meta}
            theme={theme}
            onReset={handleReset}
          />
        )}
        {stage === STAGES.ERROR && (
          <ErrorState message={error} onReset={handleReset} />
        )}
      </main>

      <Footer />
    </div>
  )
}

/** Top navigation bar with the app name and the dark/light mode toggle. */
function Header({ theme, toggleTheme }) {
  return (
    <header
      className="px-4 sm:px-6 py-4"
      style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}
    >
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl sm:text-2xl flex-shrink-0">🎵</span>
          <span
            className="text-base sm:text-xl font-bold tracking-tight truncate"
            style={{ color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}
          >
            sheet-music-to-strudel
          </span>
          <span
            className="text-xs sm:text-sm ml-1 hidden sm:inline flex-shrink-0"
            style={{ color: 'var(--text-dim)' }}
          >
            // AI music transcription
          </span>
        </div>

        {/* Dark / light mode toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle dark/light mode"
          className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer
      className="px-6 py-4 text-center"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <p className="text-xs font-mono" style={{ color: 'var(--text-dim)' }}>
        Powered by Claude AI • Made for the Strudel community
      </p>
    </footer>
  )
}

/** Shown when the API call or file processing throws an error. */
function ErrorState({ message, onReset }) {
  return (
    <div className="w-full max-w-lg text-center space-y-6 px-4">
      <div
        className="rounded-lg p-6"
        style={{
          background: 'var(--error-bg)',
          border: '1px solid var(--error-border)',
        }}
      >
        <div className="text-4xl mb-3" style={{ color: 'var(--error-text)' }}>⚠</div>
        <p className="font-mono text-sm mb-2" style={{ color: 'var(--error-text)' }}>Error</p>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message}</p>
      </div>
      <button
        onClick={onReset}
        className="px-6 py-2 rounded font-mono text-sm border transition-colors"
        style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'transparent' }}
        onMouseOver={e => { e.currentTarget.style.background = 'var(--accent-muted)' }}
        onMouseOut={e => { e.currentTarget.style.background = 'transparent' }}
      >
        Try Again
      </button>
    </div>
  )
}

/** Reads a single image File into a base64 data object the API can consume. */
function fileToBase64Images(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      resolve([{ base64, mediaType: file.type }])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}
