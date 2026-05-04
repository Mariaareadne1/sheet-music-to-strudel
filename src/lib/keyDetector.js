/**
 * keyDetector.js
 *
 * Algorithmic key detection using the Krumhansl-Schmuckler key profiles.
 * Adapted from midi-strudel's KeyDetector.ts.
 *
 * Single public export: detectKeyFromNotes(notes)
 */

// Krumhansl-Schmuckler key profiles (from midi-strudel)
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const PITCH_CLASSES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

const PITCH_MAP = {
  'c': 0, 'c#': 1, 'db': 1,
  'd': 2, 'd#': 3, 'eb': 3,
  'e': 4,
  'f': 5, 'f#': 6, 'gb': 6,
  'g': 7, 'g#': 8, 'ab': 8,
  'a': 9, 'a#': 10, 'bb': 10,
  'b': 11,
}

const DURATION_WEIGHT = {
  'whole':           4,
  'dotted_half':     3,
  'half':            2,
  'dotted_quarter':  1.5,
  'quarter':         1,
  'dotted_eighth':   0.75,
  'eighth':          0.5,
  'dotted_sixteenth':0.375,
  'sixteenth':       0.25,
  'thirty_second':   0.125,
  'quarter_triplet': 2 / 3,
  'eighth_triplet':  1 / 3,
  'sixteenth_triplet': 1 / 6,
}

function pearsonCorrelation(x, y) {
  const n    = x.length
  const meanX = x.reduce((a, b) => a + b, 0) / n
  const meanY = y.reduce((a, b) => a + b, 0) / n
  let num = 0, den1 = 0, den2 = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    num  += dx * dy
    den1 += dx * dx
    den2 += dy * dy
  }
  if (den1 === 0 || den2 === 0) return 0
  return num / Math.sqrt(den1 * den2)
}

/**
 * Detects the musical key from an array of note objects.
 *
 * @param {Array<{pitch: string, duration: string}>} notes
 *   Notes in our standard format — pitch like "c4", "f#4", "bb3"; duration like "quarter".
 * @returns {string}  Key string in Strudel scale format, e.g. "C:major", "A:minor"
 */
export function detectKeyFromNotes(notes) {
  const chroma = new Array(12).fill(0)

  for (const note of notes) {
    if (!note.pitch || note.pitch === 'rest') continue
    const letter = note.pitch.replace(/[0-9]/g, '').toLowerCase()
    const pc     = PITCH_MAP[letter]
    if (pc === undefined) continue
    const weight = DURATION_WEIGHT[note.duration] ?? 1
    chroma[pc] += weight
  }

  // No notes detected — return a safe default
  if (chroma.every(v => v === 0)) return 'C:major'

  let best = { root: 0, type: 'major', score: -2 }

  for (let i = 0; i < 12; i++) {
    const rotated = [...chroma.slice(i), ...chroma.slice(0, i)]
    const r = pearsonCorrelation(rotated, MAJOR_PROFILE)
    if (r > best.score) best = { root: i, type: 'major', score: r }
  }
  for (let i = 0; i < 12; i++) {
    const rotated = [...chroma.slice(i), ...chroma.slice(0, i)]
    const r = pearsonCorrelation(rotated, MINOR_PROFILE)
    if (r > best.score) best = { root: i, type: 'minor', score: r }
  }

  return `${PITCH_CLASSES[best.root]}:${best.type}`
}
