/**
 * InfoBadges
 *
 * Renders small pill-shaped badges showing the music metadata detected by
 * Claude: title, BPM, and time signature.  Any field that's missing is simply
 * omitted rather than showing a placeholder.
 */
export default function InfoBadges({ meta }) {
  if (!meta) return null

  const { title, bpm, timeSignature } = meta

  const items = [
    title         && { label: 'title', value: title },
    bpm           && { label: 'bpm',   value: bpm   },
    timeSignature && {
      label: 'time',
      value: Array.isArray(timeSignature)
        ? `${timeSignature[0]}/${timeSignature[1]}`
        : timeSignature,
    },
  ].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ label, value }) => (
        <span
          key={label}
          className="px-3 py-1 rounded-full text-xs font-mono"
          style={{
            background: 'var(--accent-muted)',
            border:     '1px solid var(--accent-border)',
            color:      'var(--accent)',
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>{label}: </span>
          {value}
        </span>
      ))}
    </div>
  )
}
