/**
 * strudelCompiler.js
 *
 * Pure deterministic function: music JSON → Strudel source code.
 * No approximations, no string guessing. Every decision is arithmetic.
 *
 * Single public export: compileToStrudel(json, patternMap)
 */

// ── Beat duration table (single source of truth) ─────────────────────────────

const BEAT_VALUE = {
  'whole':             4.0,
  'dotted_half':       3.0,
  'half':              2.0,
  'dotted_quarter':    1.5,
  'quarter':           1.0,
  'dotted_eighth':     0.75,
  'eighth':            0.5,
  'dotted_sixteenth':  0.375,
  'sixteenth':         0.25,
  'thirty_second':     0.125,
  'quarter_triplet':   2 / 3,
  'eighth_triplet':    1 / 3,
  'sixteenth_triplet': 1 / 6,
}

// ── Step 1 — pitch string ─────────────────────────────────────────────────────

function pitchToString(note) {
  if (!note.pitch || note.pitch === 'rest') return '~'
  return note.pitch.toLowerCase().replace(/[^a-g#b0-9]/g, '')
}

// ── Step 2 — group notes into beat slots ──────────────────────────────────────

/**
 * Groups a voice's note array into beat-sized slots.
 *
 * Each slot represents a quantum of time that maps to one token in the final
 * measure string.  Slots accumulate events until their beat total crosses a
 * clean boundary (1.0, 1.5, 2.0, 3.0, 4.0…).
 *
 * Special case: two quarter triplets accumulate to 1.333 beats (4/3), which
 * is NOT a clean boundary.  The flush is suppressed so the third triplet can
 * join them, completing the 2-beat group that slotToToken expects.
 */
function groupNotesIntoBeats(notes, beatsPerMeasure) {
  // ── chord grouping: consecutive notes with chord:true attach to the one before
  const events = []
  let i = 0
  while (i < notes.length) {
    const event = { notes: [notes[i]], beats: BEAT_VALUE[notes[i].duration] ?? 1.0 }
    i++
    while (i < notes.length && notes[i].chord === true) {
      event.notes.push(notes[i])
      i++
    }
    events.push(event)
  }

  // ── accumulate into slots
  const slots        = []
  let currentSlot    = []
  let currentBeats   = 0.0

  for (const event of events) {
    currentSlot.push(event)
    currentBeats += event.beats
    currentBeats  = Math.round(currentBeats * 1000) / 1000

    // Suppress flush when we're mid-quarter-triplet group (4/3 ≈ 1.333 beats):
    // the third triplet will bring the total to exactly 2.0.
    const atPartialQTriplet = Math.abs(currentBeats - 4 / 3) < 0.005

    if (currentBeats >= 1.0 && !atPartialQTriplet) {
      slots.push({ events: currentSlot, totalBeats: currentBeats })
      currentSlot  = []
      currentBeats = 0.0
    }
  }

  // flush any remaining events (incomplete last beat)
  if (currentSlot.length > 0) {
    slots.push({ events: currentSlot, totalBeats: currentBeats })
  }

  return slots
}

// ── Step 3 — single event → token string ─────────────────────────────────────

function eventToToken(event) {
  if (event.notes.length === 1) {
    return pitchToString(event.notes[0])
  }
  // Chord: comma-separated pitches inside brackets
  return '[' + event.notes.map(n => pitchToString(n)).join(',') + ']'
}

// ── Step 4 — beat slot → Strudel token ───────────────────────────────────────

function slotToToken(slot) {
  const { events, totalBeats } = slot

  // ── Case 1: single event spanning one or more beats
  if (events.length === 1 && totalBeats >= 1.0) {
    const token = eventToToken(events[0])
    if (totalBeats === 1.0) return token
    if (totalBeats === 1.5) return token + '@1.5'
    if (totalBeats === 2.0) return token + '@2'
    if (totalBeats === 3.0) return token + '@3'
    if (totalBeats === 4.0) return token + '@4'
    // Non-standard long duration — use exact numeric modifier
    return token + '@' + totalBeats
  }

  // ── Case 2: multiple events sharing a beat slot
  const tokens = events.map(e => eventToToken(e))

  // Two eighth notes → [a b]
  if (events.length === 2 &&
      events.every(e => Math.abs(e.beats - 0.5) < 0.005)) {
    return '[' + tokens.join(' ') + ']'
  }

  // Three eighth-note triplets (1 beat) → [a b c]
  if (events.length === 3 &&
      events.every(e => Math.abs(e.beats - 1 / 3) < 0.005)) {
    return '[' + tokens.join(' ') + ']'
  }

  // Three quarter-note triplets (2 beats) → [a b c]@2
  if (events.length === 3 &&
      events.every(e => Math.abs(e.beats - 2 / 3) < 0.005)) {
    return '[' + tokens.join(' ') + ']@2'
  }

  // Four sixteenth notes (1 beat) → [[a b c d]]
  if (events.length === 4 &&
      events.every(e => Math.abs(e.beats - 0.25) < 0.005)) {
    return '[[' + tokens.join(' ') + ']]'
  }

  // Eight 32nd notes (1 beat) → [[[a b c d e f g h]]]
  if (events.length === 8 &&
      events.every(e => Math.abs(e.beats - 0.125) < 0.005)) {
    return '[[[' + tokens.join(' ') + ']]]'
  }

  // Dotted-eighth + sixteenth (0.75 + 0.25 = 1 beat) → [a@3 b]
  if (events.length === 2 &&
      Math.abs(events[0].beats - 0.75) < 0.005 &&
      Math.abs(events[1].beats - 0.25) < 0.005) {
    return '[' + tokens[0] + '@3 ' + tokens[1] + ']'
  }

  // Fallback: assign integer @-weights relative to the shortest event in the slot
  const minBeat = Math.min(...events.map(e => e.beats))
  const weighted = events.map(e => {
    const w = Math.round(e.beats / minBeat)
    return w === 1 ? eventToToken(e) : eventToToken(e) + '@' + w
  })
  return '[' + weighted.join(' ') + ']'
}

// ── Step 5 — one measure → per-voice token strings ───────────────────────────

const VOICE_NAMES = ['treble', 'bass', 'staff2', 'staff3', 'staff4']

function measureToPatternString(measure, beatsPerMeasure) {
  const result = {}
  for (const voice of VOICE_NAMES) {
    if (!measure[voice] || measure[voice].length === 0) continue
    const slots  = groupNotesIntoBeats(measure[voice], beatsPerMeasure)
    const tokens = slots.map(s => slotToToken(s))
    result[voice] = tokens.join(' ')
  }
  return result
}

// ── Step 6 — all measures for one voice → note() pattern string ──────────────

// eslint-disable-next-line no-unused-vars
function voiceToNotePattern(measureStrings) {
  const N = measureStrings.length
  if (N === 0) return null
  if (N === 1) return `"<[${measureStrings[0]}]>/1"`
  return `"<${measureStrings.map(m => '[' + m + ']').join(' ')}>/${N}"`
}

// ── Step 7 — detect exact-string repeats, assign variable names ──────────────

function findRepeats(measureStrings) {
  const seen   = {}
  const labels = []

  for (const str of measureStrings) {
    if (!seen[str]) seen[str] = 'pattern_' + Object.keys(seen).length
    labels.push(seen[str])
  }

  const hasRepeats = Object.keys(seen).length < measureStrings.length
  return { seen, labels, hasRepeats }
}

// ── Step 9 — built-in syntax checker ─────────────────────────────────────────

function validateOutput(code) {
  const errors = []

  // Invalid @ fractions (must use bracket notation)
  if (/@0\.(5|25|125|375|75)\b/.test(code)) {
    errors.push('Invalid fractional @-modifier found — use bracket notation')
  }

  // Bracket balance (covers all of the code, not just note strings)
  let depth = 0
  for (const ch of code) {
    if (ch === '[') depth++
    if (ch === ']') depth--
    if (depth < 0) { errors.push('Mismatched brackets (extra ])'); break }
  }
  if (depth !== 0) errors.push(`Unclosed brackets: ${depth} unclosed [`)

  // Angle-bracket balance inside each note("...") call
  for (const match of (code.match(/note\("([^"]+)"\)/g) ?? [])) {
    const inner  = match.slice(6, -2)
    const opens  = (inner.match(/</g) ?? []).length
    const closes = (inner.match(/>/g) ?? []).length
    if (opens !== closes) {
      errors.push(`Mismatched <> in: ${match.slice(0, 40)}`)
    }
  }

  if (/>\s*\/\s*0/.test(code))  errors.push('Division by zero in pattern (>/0)')
  if (/note\(""\)/.test(code))  errors.push('Empty note pattern: note("")')

  if (errors.length > 0) {
    console.warn('[Sheet Music to Strudel] Compiler validation:', errors)
  }

  return { code, errors }
}

// ── Instrument / label tables ─────────────────────────────────────────────────

const INSTRUMENTS = {
  treble: 'gm_acoustic_grand_piano',
  bass:   'gm_acoustic_bass',
  staff2: 'gm_violin',
  staff3: 'gm_cello',
  staff4: 'gm_flute',
}

const VOICE_LABELS = {
  treble: 'Right hand (Treble clef)',
  bass:   'Left hand (Bass clef)',
  staff2: 'Voice 2',
  staff3: 'Voice 3',
  staff4: 'Voice 4',
}

// ── Step 8 — main export ──────────────────────────────────────────────────────

/**
 * Converts validated music JSON (from claudeApi.js or musicXmlParser.js) into
 * a complete Strudel JavaScript source string.
 *
 * @param {object} json        Validated music JSON
 * @param {object} patternMap  Visual pattern hints from scoreAnalyzer (reserved)
 * @returns {string}           Strudel source code
 */
export function compileToStrudel(json, patternMap = {}) { // eslint-disable-line no-unused-vars
  const { bpm, timeSignature, title, key, sections } = json
  const beatsPerMeasure = Array.isArray(timeSignature) ? timeSignature[0] : 4
  const tsStr           = Array.isArray(timeSignature) ? timeSignature.join('/') : '4/4'

  const lines = []
  lines.push(`// Generated by Sheet Music to Strudel`)
  lines.push(`// Title: ${title || 'Unknown'}`)
  if (key) lines.push(`// Key: ${key}`)
  lines.push(`// Time: ${tsStr} | BPM: ${bpm || 120}`)
  lines.push(``)
  lines.push(`setcps(${bpm || 120}/60/${beatsPerMeasure})`)
  lines.push(``)

  const allMeasures = (sections ?? []).flatMap(s => s.measures ?? [])

  if (allMeasures.length === 0) {
    lines.push('// No notes detected')
    const code = lines.join('\n')
    validateOutput(code)
    return code
  }

  const voices = VOICE_NAMES.filter(v =>
    allMeasures.some(m => m[v] && m[v].length > 0)
  )

  for (const voice of voices) {
    // Build token string for every measure in this voice
    const measureStrings = allMeasures.map(m => {
      const pat = measureToPatternString(m, beatsPerMeasure)
      return pat[voice] ?? ('~@' + beatsPerMeasure)
    })

    const { seen, labels, hasRepeats } = findRepeats(measureStrings)

    lines.push(`// ${VOICE_LABELS[voice] ?? voice}`)

    if (hasRepeats && measureStrings.length > 4) {
      // Repeated measures: define const variables, use arrange()
      for (const [patStr, varName] of Object.entries(seen)) {
        lines.push(`const ${voice}_${varName} = "<[${patStr}]>/1"`)
      }
      lines.push(``)
      lines.push(`$: arrange(`)
      for (const label of labels) {
        lines.push(`  [1, note(${voice}_${label}).sound("${INSTRUMENTS[voice]}").room(0.3)],`)
      }
      lines.push(`)`)
    } else {
      // No significant repeats: flat pattern string
      const N     = measureStrings.length
      const inner = measureStrings.map(m => '[' + m + ']').join(' ')
      lines.push(`$: note("<${inner}>/${N}")`)
      lines.push(`  .sound("${INSTRUMENTS[voice]}")`)
      lines.push(`  .room(0.3)`)
    }

    lines.push(``)
  }

  const code = lines.join('\n')
  validateOutput(code)
  return code
}
