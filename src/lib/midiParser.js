/**
 * midiParser.js
 *
 * Parses a MIDI (.mid / .midi) file via @tonejs/midi and returns the same
 * JSON structure that claudeApi.js and musicXmlParser.js produce, so
 * strudelCompiler.js works identically for all three input paths.
 */

import { Midi } from '@tonejs/midi'

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
