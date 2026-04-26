import { useState } from 'react'
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

export default function App() {
  const [stage, setStage] = useState(STAGES.UPLOAD)
  const [statusMsg, setStatusMsg] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleFile(file) {
    setStage(STAGES.PROCESSING)
    setError(null)

    try {
      let images = []

      if (file.type === 'application/pdf') {
        setStatusMsg('Converting PDF pages...')
        images = await pdfToImages(file)
      } else {
        setStatusMsg('Reading image...')
        images = await fileToBase64Images(file)
      }

      setStatusMsg('Reading sheet music...')
      await delay(400)
      setStatusMsg('Identifying notes...')
      const rawJson = await callClaudeAPI(images)

      setStatusMsg('Compiling Strudel pattern...')
      await delay(300)
      const strudelCode = compileToStrudel(rawJson)

      setResult({ code: strudelCode, meta: rawJson })
      setStage(STAGES.RESULTS)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong.')
      setStage(STAGES.ERROR)
    }
  }

  function handleReset() {
    setStage(STAGES.UPLOAD)
    setResult(null)
    setError(null)
    setStatusMsg('')
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0f0f0f' }}>
      <Header />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {stage === STAGES.UPLOAD && (
          <UploadZone onFile={handleFile} />
        )}
        {stage === STAGES.PROCESSING && (
          <ProcessingScreen statusMsg={statusMsg} />
        )}
        {stage === STAGES.RESULTS && result && (
          <ResultsEditor
            code={result.code}
            meta={result.meta}
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

function Header() {
  return (
    <header className="border-b border-gray-800 px-6 py-4">
      <div className="max-w-4xl mx-auto flex items-center gap-3">
        <span className="text-2xl">🎵</span>
        <span
          className="text-xl font-bold tracking-tight"
          style={{ color: '#ff69b4', fontFamily: 'JetBrains Mono, monospace' }}
        >
          sheet-music-to-strudel
        </span>
        <span className="text-gray-600 text-sm ml-2 hidden sm:inline">// AI music transcription</span>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-gray-800 px-6 py-4 text-center">
      <p className="text-gray-600 text-xs font-mono">
        Powered by Claude AI • Made for the Strudel community
      </p>
    </footer>
  )
}

function ErrorState({ message, onReset }) {
  return (
    <div className="w-full max-w-lg text-center space-y-6">
      <div className="border border-red-800 rounded-lg p-6 bg-red-950/20">
        <div className="text-red-400 text-4xl mb-3">⚠</div>
        <p className="text-red-300 font-mono text-sm mb-1">Error</p>
        <p className="text-gray-400 text-sm">{message}</p>
      </div>
      <button
        onClick={onReset}
        className="px-6 py-2 rounded font-mono text-sm border transition-colors"
        style={{
          borderColor: '#ff69b4',
          color: '#ff69b4',
          background: 'transparent',
        }}
        onMouseOver={e => {
          e.target.style.background = 'rgba(255,105,180,0.1)'
        }}
        onMouseOut={e => {
          e.target.style.background = 'transparent'
        }}
      >
        Try Again
      </button>
    </div>
  )
}

function fileToBase64Images(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      const base64 = dataUrl.split(',')[1]
      resolve([{ base64, mediaType: file.type }])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}
