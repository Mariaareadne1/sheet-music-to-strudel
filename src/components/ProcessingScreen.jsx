/**
 * ProcessingScreen
 *
 * Shown while the file is being converted and the Claude API call is in flight.
 *
 * Props:
 *   statusMsg  – current step label
 *   progress   – 0-100 integer driving the animated progress bar
 *   thumbnail  – base64 JPEG string (or null) shown as a preview with a
 *                horizontal scan-line animation while Claude processes the image
 */
export default function ProcessingScreen({ statusMsg, progress = 0, thumbnail }) {
  // Named steps with the approximate progress value at which each becomes active
  const STEPS = [
    { label: 'Preparing file',        threshold: 5  },
    { label: 'Reading sheet music',   threshold: 32 },
    { label: 'Identifying notes',     threshold: 85 },
    { label: 'Compiling Strudel code',threshold: 92 },
  ]

  const activeIndex = STEPS.reduce((acc, step, i) => (progress >= step.threshold ? i : acc), 0)

  return (
    <div className="flex flex-col items-center gap-6 text-center w-full max-w-md px-4">

      {/* ── Sheet music preview with scan-line overlay ─────────────────────── */}
      {thumbnail && (
        <div
          className="relative overflow-hidden rounded-lg"
          style={{
            width:  '220px',
            height: '140px',
            border: '1px solid var(--border)',
          }}
        >
          <img
            src={`data:image/jpeg;base64,${thumbnail}`}
            alt="Uploaded sheet music"
            className="w-full h-full object-cover"
            style={{ opacity: 0.7, filter: 'grayscale(30%)' }}
          />
          {/* Scanning line — sweeps top to bottom on a 2s loop */}
          <div className="scan-line" />
          {/* Vignette overlay */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, var(--accent-muted) 0%, transparent 20%, transparent 80%, var(--accent-muted) 100%)' }}
          />
        </div>
      )}

      {/* Spinner (shown when no thumbnail is available yet) */}
      {!thumbnail && (
        <div
          className="w-14 h-14 rounded-full border-4 spinner flex-shrink-0"
          style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }}
        />
      )}

      {/* Current status label */}
      <div className="space-y-1">
        <p className="font-mono text-base sm:text-lg" style={{ color: 'var(--accent)' }}>
          {statusMsg || 'Processing...'}
        </p>
        <p className="text-xs sm:text-sm font-mono" style={{ color: 'var(--text-dim)' }}>
          Claude is reading your sheet music
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full space-y-1.5">
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: '6px', background: 'var(--border)' }}
        >
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs font-mono text-right" style={{ color: 'var(--text-secondary)' }}>
          {Math.round(progress)}%
        </p>
      </div>

      {/* Step checklist */}
      <div className="w-full space-y-1.5">
        {STEPS.map((step, i) => {
          const done   = progress > step.threshold + 5
          const active = i === activeIndex && !done
          return (
            <div key={step.label} className="flex items-center gap-3 text-left">
              <span
                className="text-sm flex-shrink-0 w-4 text-center font-mono"
                style={{ color: done ? '#4ade80' : active ? 'var(--accent)' : 'var(--text-dim)' }}
              >
                {done ? '✓' : active ? '›' : '·'}
              </span>
              <span
                className="text-xs font-mono"
                style={{
                  color: done ? '#4ade80' : active ? 'var(--text-primary)' : 'var(--text-dim)',
                }}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Pulsing dots */}
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full"
            style={{
              background: 'var(--accent)',
              animation: `pulse-pink 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
