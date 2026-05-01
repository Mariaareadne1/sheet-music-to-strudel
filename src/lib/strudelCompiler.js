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

// ── Step 6 — condense repeated tokens within a measure ───────────────────────

// Splits a measure string into top-level tokens, respecting bracket nesting.
function tokenizeMeasure(str) {
  const tokens = []
  let depth = 0
  let current = ''
  for (const ch of str) {
    if (ch === '[') {
      depth++
      current += ch
    } else if (ch === ']') {
      depth--
      current += ch
    } else if (ch === ' ' && depth === 0) {
      if (current) { tokens.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

// Applies Rules 2 & 3: compress consecutive identical tokens.
// Simple note tokens use !N; bracket group tokens use *N.
function condenseMeasure(str) {
  const tokens = tokenizeMeasure(str)
  if (tokens.length <= 1) return str

  const result = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    let count = 1
    while (i + count < tokens.length && tokens[i + count] === token) count++

    if (count > 1) {
      const isBracketGroup = token.startsWith('[')
      result.push(isBracketGroup ? `${token}*${count}` : `${token}!${count}`)
    } else {
      result.push(token)
    }
    i += count
  }
  return result.join(' ')
}

// ── Step 7 — merge consecutive identical arrange() entries (Rules 1 & 5) ─────

function mergeArrangeEntries(labels) {
  if (labels.length === 0) return []
  const merged = []
  let i = 0
  while (i < labels.length) {
    const label = labels[i]
    let count = 1
    while (i + count < labels.length && labels[i + count] === label) count++
    merged.push({ label, count })
    i += count
  }
  return merged
}

// ── Step 8 — built-in syntax checker ─────────────────────────────────────────

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

// ── Step 9 — auto-fix invalid output ─────────────────────────────────────────

function autoFixCode(code) {
  let fixCount = 0
  const lines = code.split('\n')
  const fixed = lines.map(line => {
    let out = line

    // Fix 1: invalid sound names
    const soundMatch = out.match(/\.sound\("([^"]+)"\)/)
    if (soundMatch) {
      const name = soundMatch[1]
      if (!KNOWN_GOOD_SOUNDS.includes(name)) {
        let replacement
        if (name.includes('piano'))                                  replacement = 'gm_acoustic_grand_piano'
        else if (name.includes('bass'))                              replacement = 'gm_acoustic_bass'
        else if (name.includes('violin') || name.includes('string')) replacement = 'gm_violin'
        else if (name.includes('flute') || name.includes('wind'))    replacement = 'gm_flute'
        else if (name.includes('guitar'))                            replacement = 'gm_acoustic_guitar_nylon'
        else if (name.includes('trumpet') || name.includes('brass')) replacement = 'gm_trumpet'
        else                                                         replacement = 'gm_acoustic_grand_piano'
        out = out.replace(soundMatch[0], `.sound("${replacement}")`)
        fixCount++
      }
    }

    // Fix 2: @0.5 @0.25 @0.125 — invalid modifiers
    if (/@0\.(5|25|125)\b/.test(out)) {
      console.warn('[autoFix] Invalid @ modifier in line:', out)
      out = out.replace(/@0\.5\b/g, '')
      out = out.replace(/@0\.25\b/g, '')
      out = out.replace(/@0\.125\b/g, '')
      fixCount++
    }

    // Fix 3: division by zero
    if (/>\s*\/\s*0/.test(out)) {
      console.warn('[autoFix] Division by zero in line:', out)
      out = out.replace(/\/\s*0\b/, '/1')
      fixCount++
    }

    // Fix 4: note() with empty string
    if (/note\(""\)/.test(out)) {
      console.warn('[autoFix] Empty note pattern in line:', out)
      out = out.replace(/note\(""\)/, 'note("~ ~ ~ ~")')
      fixCount++
    }

    // Fix 5: unclosed brackets in note() pattern strings
    const noteMatch = out.match(/note\("(.+)"\)/)
    if (noteMatch) {
      let inner = noteMatch[1]
      const openSquare  = (inner.match(/\[/g) ?? []).length
      const closeSquare = (inner.match(/\]/g) ?? []).length
      if (openSquare > closeSquare) {
        inner += ']'.repeat(openSquare - closeSquare)
        out = out.replace(noteMatch[0], `note("${inner}")`)
        console.warn('[autoFix] Fixed unclosed brackets')
        fixCount++
      }
    }

    return out
  })

  if (fixCount > 0) {
    console.log(`[autoFix] Applied ${fixCount} fix(es)`)
  }
  return fixed.join('\n')
}

// ── Instrument / label tables ─────────────────────────────────────────────────

const VALID_INSTRUMENTS = {
  treble: 'gm_acoustic_grand_piano',
  bass:   'gm_acoustic_bass',
  staff2: 'gm_violin',
  staff3: 'gm_cello',
  staff4: 'gm_flute',
}

const KNOWN_GOOD_SOUNDS = [
  'gm_acoustic_grand_piano',
  'gm_bright_acoustic_piano',
  'gm_electric_grand_piano',
  'gm_honky_tonk_piano',
  'gm_electric_piano_1',
  'gm_electric_piano_2',
  'gm_harpsichord',
  'gm_clavi',
  'gm_celesta',
  'gm_glockenspiel',
  'gm_music_box',
  'gm_vibraphone',
  'gm_marimba',
  'gm_xylophone',
  'gm_tubular_bells',
  'gm_dulcimer',
  'gm_drawbar_organ',
  'gm_percussive_organ',
  'gm_rock_organ',
  'gm_church_organ',
  'gm_reed_organ',
  'gm_accordion',
  'gm_harmonica',
  'gm_tango_accordion',
  'gm_acoustic_guitar_nylon',
  'gm_acoustic_guitar_steel',
  'gm_electric_guitar_jazz',
  'gm_electric_guitar_clean',
  'gm_electric_guitar_muted',
  'gm_overdriven_guitar',
  'gm_distortion_guitar',
  'gm_guitar_harmonics',
  'gm_acoustic_bass',
  'gm_electric_bass_finger',
  'gm_electric_bass_pick',
  'gm_fretless_bass',
  'gm_slap_bass_1',
  'gm_slap_bass_2',
  'gm_synth_bass_1',
  'gm_synth_bass_2',
  'gm_violin',
  'gm_viola',
  'gm_cello',
  'gm_contrabass',
  'gm_tremolo_strings',
  'gm_pizzicato_strings',
  'gm_orchestral_harp',
  'gm_timpani',
  'gm_string_ensemble_1',
  'gm_string_ensemble_2',
  'gm_synth_strings_1',
  'gm_synth_strings_2',
  'gm_choir_aahs',
  'gm_voice_oohs',
  'gm_synth_voice',
  'gm_orchestra_hit',
  'gm_trumpet',
  'gm_trombone',
  'gm_tuba',
  'gm_muted_trumpet',
  'gm_french_horn',
  'gm_brass_section',
  'gm_synth_brass_1',
  'gm_synth_brass_2',
  'gm_soprano_sax',
  'gm_alto_sax',
  'gm_tenor_sax',
  'gm_baritone_sax',
  'gm_oboe',
  'gm_english_horn',
  'gm_bassoon',
  'gm_clarinet',
  'gm_piccolo',
  'gm_flute',
  'gm_recorder',
  'gm_pan_flute',
  'gm_blown_bottle',
  'gm_shakuhachi',
  'gm_whistle',
  'gm_ocarina',
  'gm_lead_1_square',
  'gm_lead_2_sawtooth',
  'gm_lead_3_calliope',
  'gm_lead_4_chiff',
  'gm_lead_5_charang',
  'gm_lead_6_voice',
  'gm_lead_7_fifths',
  'gm_lead_8_bass_lead',
  'gm_pad_1_new_age',
  'gm_pad_2_warm',
  'gm_pad_3_polysynth',
  'gm_pad_4_choir',
  'gm_pad_5_bowed',
  'gm_pad_6_metallic',
  'gm_pad_7_halo',
  'gm_pad_8_sweep',
  'piano',
  'sawtooth',
  'square',
  'triangle',
  'sine',
]

function getValidSound(soundName) {
  if (KNOWN_GOOD_SOUNDS.includes(soundName)) return soundName
  if (soundName.includes('piano'))                                  return 'gm_acoustic_grand_piano'
  if (soundName.includes('bass'))                                   return 'gm_acoustic_bass'
  if (soundName.includes('violin') || soundName.includes('string')) return 'gm_violin'
  if (soundName.includes('flute') || soundName.includes('wind'))    return 'gm_flute'
  if (soundName.includes('guitar'))                                 return 'gm_acoustic_guitar_nylon'
  if (soundName.includes('trumpet') || soundName.includes('brass')) return 'gm_trumpet'
  return 'gm_acoustic_grand_piano'
}

const VOICE_LABELS = {
  treble: 'Right hand (Treble clef)',
  bass:   'Left hand (Bass clef)',
  staff2: 'Voice 2',
  staff3: 'Voice 3',
  staff4: 'Voice 4',
}

// ── Step 10 — main export ─────────────────────────────────────────────────────

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
    const code = autoFixCode(lines.join('\n'))
    validateOutput(code)
    return code
  }

  const voices = VOICE_NAMES.filter(v =>
    allMeasures.some(m => m[v] && m[v].length > 0)
  )

  // Phase 1: build condensed measure strings for all voices (Rules 2 & 3)
  const voiceMeasures = {}
  for (const voice of voices) {
    voiceMeasures[voice] = allMeasures.map(m => {
      const pat = measureToPatternString(m, beatsPerMeasure)
      return condenseMeasure(pat[voice] ?? ('~@' + beatsPerMeasure))
    })
  }

  // Phase 2: determine which voices get arrange() vs flat inline
  const voiceUseArrange = {}
  for (const voice of voices) {
    const strs = voiceMeasures[voice]
    const uniqueCount = new Set(strs).size
    voiceUseArrange[voice] = uniqueCount < strs.length && strs.length > 4
  }

  // Phase 3: global pattern registry for cross-voice dedup (Rule 4)
  // patStr → canonical varName shared across all voices that use arrange()
  const patternRegistry = new Map()
  let patternIdx = 0
  for (const voice of voices) {
    if (!voiceUseArrange[voice]) continue
    for (const patStr of voiceMeasures[voice]) {
      if (!patternRegistry.has(patStr)) {
        patternRegistry.set(patStr, `pattern_${patternIdx++}`)
      }
    }
  }

  // Phase 4: generate code
  const declaredVars = new Set()
  let debugVarCount = 0

  for (const voice of voices) {
    lines.push(`// ${VOICE_LABELS[voice] ?? voice}`)
    const measureStrs = voiceMeasures[voice]
    const sound = getValidSound(VALID_INSTRUMENTS[voice])

    if (voiceUseArrange[voice]) {
      // Declare const for each unique pattern not yet declared by a prior voice (Rule 4)
      for (const patStr of [...new Set(measureStrs)]) {
        const varName = patternRegistry.get(patStr)
        if (!declaredVars.has(varName)) {
          const fullValue = `"<[${patStr}]>/1"`
          lines.push(`const ${varName} = ${fullValue}`)
          if (debugVarCount < 3) {
            console.log(`[strudelCompiler] const ${varName} =`, fullValue)
            debugVarCount++
          }
          declaredVars.add(varName)
        }
      }

      lines.push(``)
      lines.push(`$: arrange(`)

      // Merge consecutive identical labels (Rules 1 & 5)
      const labels = measureStrs.map(s => patternRegistry.get(s))
      const merged = mergeArrangeEntries(labels)
      for (const { label, count } of merged) {
        lines.push(`  [${count}, note(${label}).sound("${sound}").room(0.3)],`)
      }

      lines.push(`)`)
    } else {
      // No significant repeats or short piece: flat inline pattern
      const N     = measureStrs.length
      const inner = measureStrs.map(m => '[' + m + ']').join(' ')
      lines.push(`$: note("<${inner}>/${N}")`)
      lines.push(`  .sound("${sound}")`)
      lines.push(`  .room(0.3)`)
    }

    lines.push(``)
  }

  const rawCode = lines.join('\n')
  const fixedCode = autoFixCode(rawCode)
  validateOutput(fixedCode)
  return fixedCode
}
