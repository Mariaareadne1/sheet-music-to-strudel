import { useState, useEffect } from 'react'
import UploadZone       from './components/UploadZone.jsx'
import ProcessingScreen from './components/ProcessingScreen.jsx'
import ResultsEditor    from './components/ResultsEditor.jsx'
import HistoryDrawer    from './components/HistoryDrawer.jsx'
import { pdfToImages }      from './lib/pdfToImages.js'
import { callClaudeAPI, validateCodeWithClaude } from './lib/claudeApi.js'
import { compileToStrudel } from './lib/strudelCompiler.js'
import { saveToHistory }    from './lib/history.js'
import { createThumbnail }  from './lib/thumbnail.js'
import { parseMusicXml, isMusicXmlFile } from './lib/musicXmlParser.js'

const STAGES = { UPLOAD: 'upload', PROCESSING: 'processing', RESULTS: 'results', ERROR: 'error' }

/**
 * Root application component.
 *
 * Owns the global state machine (upload → processing → results / error),
 * dark/light theme preference, step-level progress counter, conversion
 * history, and the thumbnail generated from each uploaded file.
 */
export default function App() {
  const [stage,          setStage]         = useState(STAGES.UPLOAD)
  const [statusMsg,      setStatusMsg]     = useState('')
  const [progress,       setProgress]      = useState(0)
  const [result,         setResult]        = useState(null)
  const [error,          setError]         = useState(null)
  const [thumbnail,      setThumbnail]     = useState(null)
  const [historyOpen,    setHistoryOpen]   = useState(false)
  const [processingMode, setProcessingMode] = useState('ai')  // 'ai' | 'xml'

  // Persist theme across page reloads
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  /**
   * Full pipeline: file → thumbnail → images → Claude API → compiler → save.
   * Updates progress (0-100) at each milestone for the progress bar.
   */
  async function handleFile(file) {
    setStage(STAGES.PROCESSING)
    setError(null)
    setThumbnail(null)
    setProgress(5)

    const isXml = isMusicXmlFile(file)
    setProcessingMode(isXml ? 'xml' : 'ai')

    try {
      if (isXml) {
        // ── MusicXML path — no AI needed ─────────────────────────────────────

        setStatusMsg('Reading MusicXML structure...')
        setProgress(20)
        const rawJson = await parseMusicXml(file)

        setStatusMsg('Parsing notes and rhythms...')
        setProgress(50)
        await delay(60)

        setStatusMsg('Compiling Strudel patterns...')
        setProgress(75)
        const rawCode = compileToStrudel(rawJson, {})

        setStatusMsg('Validating syntax...')
        setProgress(88)
        const strudelCode = await validateCodeWithClaude(rawCode)

        saveToHistory({
          title:         rawJson.title,
          bpm:           rawJson.bpm,
          timeSignature: rawJson.timeSignature,
          key:           rawJson.key,
          code:          strudelCode,
          thumbnail:     null,
          source:        'musicxml',
        })

        setProgress(100)
        await delay(150)
        setResult({ code: strudelCode, meta: rawJson, thumbnail: null, source: 'musicxml' })
        setStage(STAGES.RESULTS)

      } else {
        // ── AI vision path (PDF / image) ──────────────────────────────────────
        let images = []

        // 1. Convert file to images
        if (file.type === 'application/pdf') {
          setStatusMsg('Converting PDF pages...')
          images = await pdfToImages(file)
        } else {
          setStatusMsg('Reading image...')
          images = await fileToBase64Images(file)
        }
        setProgress(12)

        // 2. Generate thumbnail
        if (images.length > 0) {
          const thumb = await createThumbnail(images[0].base64, images[0].mediaType)
          setThumbnail(thumb)
        }
        setProgress(16)

        // 3. Multi-step Claude pipeline
        setStatusMsg('Detecting key signature...')
        const { json: rawJson, patternMap } = await callClaudeAPI(images, (p, msg) => {
          if (msg) setStatusMsg(msg)
          setProgress(16 + Math.round(p * 0.69))
        })
        setProgress(85)

        // 4. Compile
        setStatusMsg('Compiling Strudel patterns...')
        setProgress(88)
        await delay(80)
        const rawCode = compileToStrudel(rawJson, patternMap)

        // 5. Validate
        setStatusMsg('Validating Strudel syntax...')
        setProgress(93)
        const strudelCode = await validateCodeWithClaude(rawCode)

        // 6. Save to history
        const thumb = (images.length > 0)
          ? await createThumbnail(images[0].base64, images[0].mediaType).catch(() => null)
          : null

        saveToHistory({
          title:         rawJson.title,
          bpm:           rawJson.bpm,
          timeSignature: rawJson.timeSignature,
          key:           rawJson.key,
          code:          strudelCode,
          thumbnail:     thumb,
          source:        'ai',
        })

        setProgress(100)
        await delay(150)
        setResult({ code: strudelCode, meta: rawJson, thumbnail: thumb, source: 'ai' })
        setStage(STAGES.RESULTS)
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong.')
      setStage(STAGES.ERROR)
    }
  }

  /** Resets everything back to the upload screen. */
  function handleReset() {
    setStage(STAGES.UPLOAD)
    setResult(null)
    setError(null)
    setStatusMsg('')
    setProgress(0)
    setThumbnail(null)
    setProcessingMode('ai')
  }

  /**
   * Loads a history entry directly into the results view without re-running
   * the API — the drawer calls this when the user taps "Load".
   */
  function handleLoadFromHistory(entry) {
    setResult({
      code:      entry.code,
      meta:      {
        title:         entry.title,
        bpm:           entry.bpm,
        timeSignature: entry.timeSignature,
        key:           entry.key,
      },
      thumbnail: entry.thumbnail,
      source:    entry.source ?? 'ai',
    })
    setStage(STAGES.RESULTS)
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--bg)', color: 'var(--text-primary)', transition: 'background 0.2s, color 0.2s' }}
    >
      <Header
        theme={theme}
        toggleTheme={toggleTheme}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {stage === STAGES.UPLOAD && (
          <UploadZone onFile={handleFile} />
        )}
        {stage === STAGES.PROCESSING && (
          <ProcessingScreen
            statusMsg={statusMsg}
            progress={progress}
            thumbnail={thumbnail}
            mode={processingMode}
          />
        )}
        {stage === STAGES.RESULTS && result && (
          <ResultsEditor
            code={result.code}
            meta={result.meta}
            theme={theme}
            thumbnail={result.thumbnail}
            source={result.source ?? 'ai'}
            onReset={handleReset}
          />
        )}
        {stage === STAGES.ERROR && (
          <ErrorState message={error} onReset={handleReset} />
        )}
      </main>

      <Footer />

      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onLoad={handleLoadFromHistory}
      />
    </div>
  )
}

// ── Layout components ─────────────────────────────────────────────────────────

function Header({ theme, toggleTheme, onOpenHistory }) {
  return (
    <header
      className="px-4 sm:px-6 py-3"
      style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}
    >
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        {/* Branding */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl flex-shrink-0">🎵</span>
          <span
            className="text-sm sm:text-lg font-bold tracking-tight truncate"
            style={{ color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}
          >
            sheet-music-to-strudel
          </span>
          <span className="text-xs hidden md:inline flex-shrink-0" style={{ color: 'var(--text-dim)' }}>
            // AI music transcription
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* History button */}
          <button
            onClick={onOpenHistory}
            aria-label="Open conversion history"
            title="Conversion history"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-base transition-colors"
            style={{
              background: 'var(--surface-raised)',
              border:     '1px solid var(--border)',
              color:      'var(--text-secondary)',
              cursor:     'pointer',
            }}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
            onMouseOut={e =>  { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            🕐
          </button>

          {/* Dark / light mode toggle */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle dark/light mode"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-base transition-colors"
            style={{
              background: 'var(--surface-raised)',
              border:     '1px solid var(--border)',
              color:      'var(--text-secondary)',
              cursor:     'pointer',
            }}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="px-6 py-3 text-center" style={{ borderTop: '1px solid var(--border)' }}>
      <p className="text-xs font-mono" style={{ color: 'var(--text-dim)' }}>
        Powered by Claude AI • Made for the Strudel community
      </p>
    </footer>
  )
}

function ErrorState({ message, onReset }) {
  return (
    <div className="w-full max-w-lg text-center space-y-6 px-4">
      <div
        className="rounded-lg p-6"
        style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)' }}
      >
        <div className="text-4xl mb-3" style={{ color: 'var(--error-text)' }}>⚠</div>
        <p className="font-mono text-sm mb-2" style={{ color: 'var(--error-text)' }}>Error</p>
        <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{message}</p>
      </div>
      <button
        onClick={onReset}
        className="px-6 py-2 rounded font-mono text-sm border transition-colors"
        style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'transparent' }}
        onMouseOver={e => { e.currentTarget.style.background = 'var(--accent-muted)' }}
        onMouseOut={e =>  { e.currentTarget.style.background = 'transparent' }}
      >
        Try Again
      </button>
    </div>
  )
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Reads a single image File into the { base64, mediaType } shape the API expects. */
function fileToBase64Images(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve([{ base64: reader.result.split(',')[1], mediaType: file.type }])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}
