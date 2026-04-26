/**
 * ProcessingScreen
 *
 * Shown while the file is being converted and the Claude API is in flight.
 * Accepts:
 *   statusMsg  – human-readable current step label
 *   progress   – 0-100 number that drives the animated progress bar
 */
export default function ProcessingScreen({ statusMsg, progress = 0 }) {
  // Each named step maps to the approximate progress value at which it appears.
  const STEPS = [
    { label: 'Preparing file',         threshold: 5  },
    { label: 'Reading sheet music',    threshold: 30 },
    { label: 'Identifying notes',      threshold: 85 },
    { label: 'Compiling Strudel code', threshold: 92 },
  ]

  // The active step is the last one whose threshold has been reached.
  const activeIndex = STEPS.reduce((acc, step, i) => {
    return progress >= step.threshold ? i : acc
  }, 0)

  return (
    <div className="flex flex-col items-center gap-8 text-center w-full max-w-md px-4">

      {/* Spinner */}
      <div
        className="w-14 h-14 rounded-full border-4 spinner flex-shrink-0"
        style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }}
      />

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
      <div className="w-full space-y-2">
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: '6px', background: 'var(--border)' }}
        >
          <div
            className="progress-bar-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs font-mono text-right" style={{ color: 'var(--text-secondary)' }}>
          {Math.round(progress)}%
        </p>
      </div>

      {/* Step checklist */}
      <div className="w-full space-y-2">
        {STEPS.map((step, i) => {
          const done    = progress > step.threshold + 5
          const active  = i === activeIndex && !done
          return (
            <div
              key={step.label}
              className="flex items-center gap-3 text-left"
            >
              {/* Status icon */}
              <span
                className="text-sm flex-shrink-0 w-4 text-center"
                style={{ color: done ? '#4ade80' : active ? 'var(--accent)' : 'var(--text-dim)' }}
              >
                {done ? '✓' : active ? '›' : '·'}
              </span>
              <span
                className="text-xs font-mono"
                style={{
                  color: done
                    ? '#4ade80'
                    : active
                    ? 'var(--text-primary)'
                    : 'var(--text-dim)',
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
