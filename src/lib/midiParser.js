/**
 * midiParser.js
 *
 * Parses a MIDI (.mid / .midi) file via @tonejs/midi and returns the same
 * JSON structure that claudeApi.js and musicXmlParser.js produce, so
 * strudelCompiler.js works identically for all three input paths.
 */

import { Midi } from '@tonejs/midi'

// ── Instrument scoring (from midi-strudel constants.ts) ───────────────────────

const INSTRUMENTS = [
  'triangle', 'sine', 'square', 'sawtooth',
  'gm_accordion', 'gm_acoustic_bass', 'gm_acoustic_guitar_nylon', 'gm_acoustic_guitar_steel',
  'gm_alto_sax', 'gm_baritone_sax', 'gm_bassoon', 'gm_brass_section',
  'gm_celesta', 'gm_cello', 'gm_choir_aahs', 'gm_church_organ',
  'gm_clarinet', 'gm_contrabass', 'gm_distortion_guitar',
  'gm_drawbar_organ', 'gm_electric_bass_finger', 'gm_electric_bass_pick',
  'gm_electric_guitar_clean', 'gm_electric_guitar_jazz', 'gm_electric_guitar_muted',
  'gm_english_horn', 'gm_epiano1', 'gm_epiano2', 'gm_flute', 'gm_french_horn',
  'gm_fretless_bass', 'gm_glockenspiel', 'gm_harmonica', 'gm_harpsichord',
  'gm_lead_1_square', 'gm_lead_2_sawtooth', 'gm_marimba',
  'gm_muted_trumpet', 'gm_oboe', 'gm_orchestra_hit', 'gm_orchestral_harp',
  'gm_overdriven_guitar', 'gm_pad_new_age', 'gm_pad_warm', 'gm_pan_flute',
  'gm_piano', 'gm_piccolo', 'gm_pizzicato_strings',
  'gm_slap_bass_1', 'gm_slap_bass_2', 'gm_soprano_sax',
  'gm_string_ensemble_1', 'gm_string_ensemble_2', 'gm_synth_bass_1',
  'gm_synth_bass_2', 'gm_synth_brass_1', 'gm_synth_choir',
  'gm_tenor_sax', 'gm_timpani', 'gm_tremolo_strings', 'gm_trombone',
  'gm_trumpet', 'gm_tuba', 'gm_tubular_bells', 'gm_vibraphone',
  'gm_viola', 'gm_violin', 'gm_voice_oohs', 'gm_xylophone',
]

// Verified drum map from midi-strudel constants.ts
export const DRUM_MAP = {
  35: 'bd', 36: 'bd',   // Acoustic Bass Drum, Bass Drum 1
  38: 'sd', 40: 'sd',   // Acoustic Snare, Electric Snare
  37: 'rim',             // Side Stick
  42: 'hh', 44: 'hh',   // Closed Hi Hat, Pedal Hi-Hat
  46: 'oh',              // Open Hi-Hat
  41: 'lt',              // Low Tom
  45: 'mt',              // Low-Mid Tom
  47: 'ht',              // Hi-Mid Tom
  51: 'rd',              // Ride Cymbal 1
  49: 'cr', 57: 'cr',   // Crash Cymbal 1 and 2
  56: 'cb',              // Cowbell
  82: 'sh',              // Shaker
}

/**
 * Smart instrument selection from midi-strudel's scoring system.
 * Scores each candidate instrument name against track name and family,
 * preferring exact matches, then word matches, then fallback heuristics.
 */
export function getAutoSound(trackName, instrumentFamily, _programNumber) {
  const name   = (trackName || '').toLowerCase()
  const family = (instrumentFamily || '').toLowerCase()
  const searchTerms = `${name} ${family}`

  // Explicit override: generic synth → triangle waveform
  if (searchTerms.includes('synth') && !searchTerms.includes('bass')
      && !searchTerms.includes('strings') && !searchTerms.includes('brass')) {
    return 'triangle'
  }

  // Explicit override: generic strings label → ensemble
  if (name.trim() === 'strings' || (name.includes('string')
      && !name.includes('guitar') && !name.includes('bass'))) {
    return 'gm_string_ensemble_1'
  }

  // Dynamic scoring against INSTRUMENTS list
  const trackWords = searchTerms.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2)
  let bestInst = null
  let maxScore = 0

  for (const inst of INSTRUMENTS) {
    if (!inst.startsWith('gm_')) continue
    const instNameClean = inst.replace(/^gm_/, '').replace(/_/g, ' ')
    const instWords = instNameClean.split(' ')
    let score = 0
    if (searchTerms.includes(instNameClean)) score += 20
    for (const iWord of instWords) {
      if (trackWords.includes(iWord)) score += 5
      else if (searchTerms.includes(iWord)) score += 2
    }
    if (score > maxScore) { maxScore = score; bestInst = inst }
  }

  if (maxScore >= 5) return bestInst

  // Fallbacks by keyword
  if (searchTerms.includes('guitar')) {
    if (searchTerms.includes('electric')) return 'gm_electric_guitar_clean'
    if (searchTerms.includes('bass'))     return 'gm_electric_bass_pick'
    return 'gm_acoustic_guitar_nylon'
  }
  if (searchTerms.includes('bass'))  return 'gm_acoustic_bass'
  if (searchTerms.includes('piano')) return 'gm_piano'
  if (searchTerms.includes('drum'))  return 'gm_synth_drum'

  return 'gm_piano'
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseMidiFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  let midi
  try {
    midi = new Midi(arrayBuffer)
  } catch {
    throw new Error('Failed to parse MIDI file. The file may be corrupt or unsupported.')
  }

  const bpm = midi.header.tempos.length > 0
    ? Math.round(midi.header.tempos[0].bpm)
    : 120

  const ts = midi.header.timeSignatures.length > 0
    ? {
        numerator:   midi.header.timeSignatures[0].timeSignature[0],
        denominator: midi.header.timeSignatures[0].timeSignature[1],
      }
    : { numerator: 4, denominator: 4 }

  const tracks = midi.tracks.map((t, index) => {
    const notes = t.notes.map(n => ({
      note:     n.name,
      midi:     n.midi,
      noteOn:   n.time,
      noteOff:  n.time + n.duration,
      velocity: n.velocity,
    }))

    const nameLower = t.name.toLowerCase()
    const isDrum = t.instrument.percussion
      || t.channel === 9
      || nameLower.includes('drum')
      || nameLower.includes('perc')

    return {
      id:               `track-${index}`,
      name:             t.name || `Track ${index + 1}`,
      instrumentFamily: t.instrument.family,
      notes,
      hidden:           notes.length === 0,
      isDrum,
    }
  })

  return { tracks, bpm, timeSignature: ts }
}

export function isMidiFile(file) {
  const name = (file.name ?? '').toLowerCase()
  return name.endsWith('.mid') || name.endsWith('.midi')
}

// ── Track → JSON schema converter ─────────────────────────────────────────────

/**
 * Converts the midi-strudel track format to our internal music JSON schema
 * (same shape as claudeApi.js / musicXmlParser.js output).
 *
 * @param {Array}  tracks        Output of parseMidiFile().tracks
 * @param {number} bpm
 * @param {{numerator: number, denominator: number}} timeSignature
 * @returns {object}  { bpm, timeSignature, title, key, sections }
 */
export function midiTracksToJson(tracks, bpm, timeSignature) {
  const beatsPerMeasure = timeSignature.numerator
  const beatDurSec      = 60 / bpm
  const measureDurSec   = beatsPerMeasure * beatDurSec

  const VOICE_NAMES  = ['treble', 'bass', 'staff2', 'staff3', 'staff4']
  const activeTracks = tracks.filter(t => !t.hidden && !t.isDrum).slice(0, 5)

  // Total duration from the last note-off across all active tracks
  let maxTime = 0
  for (const track of activeTracks) {
    for (const n of track.notes) {
      if (n.noteOff > maxTime) maxTime = n.noteOff
    }
  }

  const numMeasures = Math.max(1, Math.ceil(maxTime / measureDurSec))

  const measures = []
  for (let mi = 0; mi < numMeasures; mi++) {
    const mStart = mi * measureDurSec
    const mEnd   = mStart + measureDurSec
    const measure = {}

    activeTracks.forEach((track, ti) => {
      const voice = VOICE_NAMES[ti]
      const notesInMeasure = []
      let   prevEndBeat    = 0

      // Sort by noteOn time to process in order
      const sorted = track.notes
        .filter(n => n.noteOn >= mStart - 0.001 && n.noteOn < mEnd - 0.001)
        .sort((a, b) => a.noteOn - b.noteOn)

      for (const n of sorted) {
        const startBeat = (n.noteOn - mStart) / beatDurSec
        const durBeats  = Math.max(0.125, (n.noteOff - n.noteOn) / beatDurSec)

        // Insert a rest for any gap before this note
        if (startBeat > prevEndBeat + 0.05) {
          const restBeats = startBeat - prevEndBeat
          notesInMeasure.push({ pitch: 'rest', duration: beatsToString(restBeats) })
        }

        notesInMeasure.push({
          pitch:    midiNoteToPitch(n.note),
          duration: beatsToString(durBeats),
        })
        prevEndBeat = startBeat + durBeats
      }

      if (notesInMeasure.length > 0) {
        measure[voice] = notesInMeasure
      }
    })

    // Only include measures that have at least one note
    if (Object.keys(measure).length > 0) {
      measures.push(measure)
    }
  }

  // Pick a human-readable title from the first named track
  const title = activeTracks.find(t => t.name && !t.name.startsWith('Track '))?.name
    ?? 'MIDI Import'

  return {
    bpm,
    timeSignature: [timeSignature.numerator, timeSignature.denominator],
    title,
    key:      'C major',  // placeholder — caller should run detectKeyFromNotes
    sections: [{ name: 'main', measures }],
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// @tonejs/midi returns names like "C4", "F#4", "Bb3" → lowercase for our format
function midiNoteToPitch(name) {
  return name.toLowerCase()
}

// Best-fit mapping from a float beat duration to a standard duration string
function beatsToString(beats) {
  if (Math.abs(beats - 4)     < 0.15) return 'whole'
  if (Math.abs(beats - 3)     < 0.15) return 'dotted_half'
  if (Math.abs(beats - 2)     < 0.15) return 'half'
  if (Math.abs(beats - 1.5)   < 0.12) return 'dotted_quarter'
  if (Math.abs(beats - 1)     < 0.12) return 'quarter'
  if (Math.abs(beats - 0.75)  < 0.08) return 'dotted_eighth'
  if (Math.abs(beats - 0.5)   < 0.08) return 'eighth'
  if (Math.abs(beats - 0.375) < 0.06) return 'dotted_sixteenth'
  if (Math.abs(beats - 0.25)  < 0.06) return 'sixteenth'
  if (Math.abs(beats - 0.125) < 0.04) return 'thirty_second'
  // Fallback: clamp to nearest standard
  if (beats >= 3)   return 'dotted_half'
  if (beats >= 2)   return 'half'
  if (beats >= 1)   return 'quarter'
  if (beats >= 0.5) return 'eighth'
  return 'sixteenth'
}
