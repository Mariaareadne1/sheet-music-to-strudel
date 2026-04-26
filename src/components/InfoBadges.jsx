export default function InfoBadges({ meta }) {
  if (!meta) return null
  const { title, bpm, timeSignature } = meta
  const items = [
    title && { label: 'title', value: title },
    bpm && { label: 'bpm', value: bpm },
    timeSignature && {
      label: 'time',
      value: Array.isArray(timeSignature)
        ? `${timeSignature[0]}/${timeSignature[1]}`
        : timeSignature,
    },
  ].filter(Boolean)

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ label, value }) => (
        <span
          key={label}
          className="px-3 py-1 rounded-full text-xs font-mono"
          style={{
            background: 'rgba(255,105,180,0.1)',
            border: '1px solid rgba(255,105,180,0.3)',
            color: '#ff69b4',
          }}
        >
          <span className="text-gray-500">{label}: </span>
          {value}
        </span>
      ))}
    </div>
  )
}
