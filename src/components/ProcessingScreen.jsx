export default function ProcessingScreen({ statusMsg }) {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div
        className="w-16 h-16 rounded-full border-4 spinner"
        style={{
          borderColor: '#2a2a2a',
          borderTopColor: '#ff69b4',
        }}
      />
      <div className="space-y-2">
        <p className="font-mono text-lg" style={{ color: '#ff69b4' }}>
          {statusMsg || 'Processing...'}
        </p>
        <p className="text-gray-600 text-sm font-mono">
          Claude is reading your sheet music
        </p>
      </div>
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full"
            style={{
              background: '#ff69b4',
              animation: `pulse-pink 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
