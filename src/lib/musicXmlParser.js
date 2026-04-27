/**
 * musicXmlParser.js
 *
 * Parses a MusicXML (.xml) or compressed MusicXML (.mxl) file and returns the
 * exact same JSON structure that claudeApi.js produces, so strudelCompiler.js
 * works identically for both input paths.
 *
 * Handles:
 *   - Key signature (fifths + mode → human-readable name)
 *   - Time signature and BPM tempo markings
 *   - Note types, dots, triplets (time-modification), rests, chords, ties
 *   - Multi-staff parts (piano treble + bass)
 *   - Multi-part ensemble scores
 *   - Forward/backward repeat barlines
 *   - .mxl decompression via JSZip
 */

import JSZip from 'jszip'

// ── Lookup tables ─────────────────────────────────────────────────────────────

const KEY_MAJOR = {
   '0': 'C major',  '1': 'G major',  '2': 'D major',  '3': 'A major',
   '4': 'E major',  '5': 'B major',  '6': 'F# major', '7': 'C# major',
  '-1': 'F major', '-2': 'Bb major', '-3': 'Eb major', '-4': 'Ab major',
  '-5': 'Db major', '-6': 'Gb major', '-7': 'Cb major',
}

const KEY_MINOR = {
   '0': 'A minor',  '1': 'E minor',  '2': 'B minor',  '3': 'F# minor',
   '4': 'C# minor', '5': 'G# minor', '6': 'D# minor', '7': 'A# minor',
  '-1': 'D minor', '-2': 'G minor', '-3': 'C minor', '-4': 'F minor',
  '-5': 'Bb minor', '-6': 'Eb minor', '-7': 'Ab minor',
}

// MusicXML <type> element value → our duration name
const TYPE_MAP = {
  'whole':   'whole',
  'half':    'half',
  'quarter': 'quarter',
  'eighth':  'eighth',
  '16th':    'sixteenth',
  '32nd':    'thirty_second',
  '64th':    'thirty_second',  // treat 64th as 32nd
  'breve':   'whole',           // double whole → whole
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if the file is a MusicXML or compressed MusicXML file.
 * Checked by extension only (MIME types vary too much across browsers/OS).
 */
export function isMusicXmlFile(file) {
  const name = (file.name ?? '').toLowerCase()
  return name.endsWith('.xml') || name.endsWith('.mxl')
}

/**
 * Parses a MusicXML or .mxl File and returns the music JSON structure.
 *
 * @param {File} file
 * @returns {Promise<object>}  Same shape as claudeApi.js output
 */
export async function parseMusicXml(file) {
  try {
    const xmlString = file.name.toLowerCase().endsWith('.mxl')
      ? await unzipMxl(file)
      : await file.text()
    return parseXmlString(xmlString)
  } catch (err) {
    // Re-throw with a friendlier prefix so App.jsx can surface it
    throw new Error(`MusicXML parse failed: ${err.message}`)
  }
}

// ── .mxl decompression ────────────────────────────────────────────────────────

async function unzipMxl(file) {
  const zip = await JSZip.loadAsync(file)

  // Try META-INF/container.xml first — it's the authoritative index
  let mainPath = null
  const containerFile = zip.file('META-INF/container.xml')
  if (containerFile) {
    const container = await containerFile.async('text')
    const m = container.match(/full-path="([^"]+\.xml[^"]*)"/i)
    if (m) mainPath = m[1]
  }

  // Fallback: first .xml file not inside META-INF, sorted so root files come first
  if (!mainPath) {
    const xmlFiles = Object.keys(zip.files)
      .filter(f => f.toLowerCase().endsWith('.xml') && !f.startsWith('META-INF'))
      .sort((a, b) => a.split('/').length - b.split('/').length)
    if (xmlFiles.length > 0) mainPath = xmlFiles[0]
  }

  if (!mainPath) throw new Error('No MusicXML content found inside the .mxl archive.')

  const entry = zip.file(mainPath)
  if (!entry) throw new Error(`Listed file "${mainPath}" not found in archive.`)
  return entry.async('text')
}

// ── Top-level XML parser ──────────────────────────────────────────────────────

function parseXmlString(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml')

  const parseErr = doc.querySelector('parsererror')
  if (parseErr) {
    throw new Error(`Invalid XML: ${parseErr.textContent.slice(0, 200)}`)
  }

  // Title: work-title takes precedence over movement-title
  const title = getTextContent(doc, 'work-title') ||
                getTextContent(doc, 'movement-title') ||
                'Unknown'

  const parts = [...doc.querySelectorAll('part')]
  if (parts.length === 0) throw new Error('No <part> elements found in the MusicXML file.')

  // Global attributes from the first measure of the first part
  const firstMeasure = parts[0].querySelector('measure')
  if (!firstMeasure) throw new Error('No measures found in the MusicXML file.')

  const { key, timeSignature } = parseAttributes(firstMeasure)

  // Tempo: look for <sound tempo="N"> anywhere in the document
  const bpm = parseBpm(doc) || 120

  // Build (partIdx, staffNum) → voiceName map
  const voiceMap = buildVoiceMap(parts)

  // Parse + expand repeats for each part, then merge into combined measures
  const measures = parseParts(parts, voiceMap, timeSignature)

  // Drop fully-empty measures (e.g. pickup/rest-only measure artefacts)
  const validMeasures = measures.filter(
    m => Object.values(m).some(arr => arr.length > 0 && arr.some(n => n.pitch !== 'rest'))
  )

  if (validMeasures.length === 0) {
    // Fall back to all measures (maybe the piece is all rests - unlikely but safe)
    if (measures.length === 0) {
      throw new Error('No notes found in the MusicXML file.')
    }
    return buildResult(bpm, timeSignature, title, key, measures)
  }

  return buildResult(bpm, timeSignature, title, key, validMeasures)
}

function buildResult(bpm, timeSignature, title, key, measures) {
  return {
    bpm,
    timeSignature,
    title,
    key,
    sections: [{ name: 'main', measures }],
  }
}

// ── Attribute parsing ─────────────────────────────────────────────────────────

function parseAttributes(measureEl) {
  const attrsEl = measureEl.querySelector('attributes')
  let key = 'C major'
  let timeSignature = [4, 4]

  if (attrsEl) {
    // Key signature
    const fifthsEl = attrsEl.querySelector('key fifths')
    const modeEl   = attrsEl.querySelector('key mode')
    if (fifthsEl) {
      const fifths = parseInt(fifthsEl.textContent) || 0
      const mode   = modeEl?.textContent?.toLowerCase() ?? 'major'
      const map    = mode === 'minor' ? KEY_MINOR : KEY_MAJOR
      key = map[String(fifths)] || 'C major'
    }

    // Time signature
    const beatsEl    = attrsEl.querySelector('time beats')
    const beatTypeEl = attrsEl.querySelector('time beat-type')
    if (beatsEl && beatTypeEl) {
      timeSignature = [
        parseInt(beatsEl.textContent) || 4,
        parseInt(beatTypeEl.textContent) || 4,
      ]
    }
  }

  return { key, timeSignature }
}

function parseBpm(doc) {
  // <sound tempo="N"/> is the most reliable source
  for (const el of doc.querySelectorAll('sound[tempo]')) {
    const t = parseFloat(el.getAttribute('tempo'))
    if (t > 0) return Math.round(t)
  }
  // Fallback: <metronome><per-minute>
  const perMinute = doc.querySelector('metronome per-minute')
  if (perMinute) {
    const t = parseFloat(perMinute.textContent)
    if (t > 0) return Math.round(t)
  }
  return null
}

// ── Voice map ─────────────────────────────────────────────────────────────────

/**
 * Assigns a voice name (treble, bass, staff2…) to each (partIdx, staffNum) pair.
 * Sequential assignment so piano's two staves get treble + bass.
 */
function buildVoiceMap(parts) {
  const map      = {}
  const sequence = ['treble', 'bass', 'staff2', 'staff3', 'staff4', 'staff5', 'staff6']
  let idx = 0

  for (let pi = 0; pi < parts.length; pi++) {
    const staves = getStavesUsed(parts[pi])
    for (const staff of staves) {
      map[`${pi}-${staff}`] = sequence[idx] || `staff${idx + 1}`
      idx++
    }
  }
  return map
}

function getStavesUsed(part) {
  const staves = new Set()
  part.querySelectorAll('note staff').forEach(el => {
    const n = parseInt(el.textContent)
    if (!isNaN(n)) staves.add(n)
  })
  if (staves.size === 0) staves.add(1)  // assume staff 1 if no staff elements
  return [...staves].sort((a, b) => a - b)
}

// ── Part / measure parsing ────────────────────────────────────────────────────

function parseParts(parts, voiceMap, timeSignature) {
  const perPartMeasures = parts.map((part, pi) =>
    parsePartMeasures(part, pi, voiceMap, timeSignature)
  )

  const maxLen = Math.max(...perPartMeasures.map(s => s.length), 0)

  // Merge all parts into one combined measure array
  const combined = []
  for (let mi = 0; mi < maxLen; mi++) {
    const measure = {}
    for (const partMeasures of perPartMeasures) {
      const m = partMeasures[mi]
      if (!m) continue
      for (const [voice, notes] of Object.entries(m)) {
        if (!measure[voice]) measure[voice] = []
        measure[voice] = measure[voice].concat(notes)
      }
    }
    combined.push(measure)
  }
  return combined
}

function parsePartMeasures(part, partIdx, voiceMap, timeSignature) {
  const measureEls  = [...part.querySelectorAll('measure')]
  const rawMeasures = []
  let divisions     = 1
  let repeatStart   = 0

  for (const measureEl of measureEls) {
    // Refresh divisions if this measure redefines them
    const divsEl = measureEl.querySelector('attributes divisions')
    if (divsEl) divisions = parseInt(divsEl.textContent) || divisions

    // Detect repeat markers in barlines
    let fwd = false, bwd = false
    for (const bl of measureEl.querySelectorAll('barline')) {
      const rep = bl.querySelector('repeat')
      if (!rep) continue
      const dir = rep.getAttribute('direction')
      if (dir === 'forward')  fwd = true
      if (dir === 'backward') bwd = true
    }

    if (fwd) repeatStart = rawMeasures.length

    const measureNotes = parseMeasureNotes(measureEl, partIdx, voiceMap)
    rawMeasures.push(measureNotes)

    if (bwd) {
      // Duplicate from repeatStart through the current measure
      const segment = rawMeasures.slice(repeatStart)
      for (const m of segment) rawMeasures.push(deepClone(m))
    }
  }

  return rawMeasures
}

// ── Note parsing ──────────────────────────────────────────────────────────────

function parseMeasureNotes(measureEl, partIdx, voiceMap) {
  const noteEls = [...measureEl.querySelectorAll('note')]
  const raw     = []

  for (const noteEl of noteEls) {
    // Grace notes are ornamental and don't occupy rhythmic space — skip
    if (noteEl.querySelector('grace')) continue

    // Ties: stop-only notes are continuations of a previous tied note; skip them
    const ties    = [...noteEl.querySelectorAll('tie')]
    const tieStop = ties.some(t => t.getAttribute('type') === 'stop')
    const tieStart = ties.some(t => t.getAttribute('type') === 'start')
    if (tieStop && !tieStart) continue  // pure continuation note

    // Is it a rest?
    const isRest = !!noteEl.querySelector('rest')

    // Pitch
    let pitch = 'rest'
    if (!isRest) {
      const step   = noteEl.querySelector('pitch step')?.textContent   ?? 'C'
      const alter  = parseFloat(noteEl.querySelector('pitch alter')?.textContent ?? '0')
      const octave = noteEl.querySelector('pitch octave')?.textContent ?? '4'
      const acc    = alter >=  1 ? '#' : alter <= -1 ? 'b' : ''
      pitch        = step.toLowerCase() + acc + octave
    }

    // Duration type — use <type> element, not <duration> (which varies by divisions)
    const typeText = noteEl.querySelector('type')?.textContent ?? 'quarter'
    let   dur      = TYPE_MAP[typeText] || 'quarter'

    // Dotted note
    if (noteEl.querySelector('dot') && !dur.startsWith('dotted_')) {
      dur = 'dotted_' + dur
    }

    // Triplet (time-modification with actual-notes = 3)
    const actualNotes = noteEl.querySelector('time-modification actual-notes')
    if (actualNotes && parseInt(actualNotes.textContent) === 3) {
      // Only apply triplet if not already dotted (dotted triplets are unusual)
      const base = dur.replace('dotted_', '')
      if      (base === 'eighth')    dur = 'eighth_triplet'
      else if (base === 'quarter')   dur = 'quarter_triplet'
      else if (base === 'sixteenth') dur = 'sixteenth_triplet'
    }

    // Staff (default 1)
    const staffEl = noteEl.querySelector('staff')
    const staff   = staffEl ? (parseInt(staffEl.textContent) || 1) : 1
    const voice   = voiceMap[`${partIdx}-${staff}`] || 'treble'

    // Chord flag: <chord/> means this note is simultaneous with the previous one
    const isChord = !!noteEl.querySelector('chord')

    raw.push({ pitch, duration: dur, voice, isChord })
  }

  // Mark chord groups: when note[i] has isChord=true, note[i-1] in the same
  // voice also becomes chord:true so the compiler groups them correctly.
  const byVoice = {}
  for (const n of raw) {
    if (!byVoice[n.voice]) byVoice[n.voice] = []
    byVoice[n.voice].push({ pitch: n.pitch, duration: n.duration, _isChord: n.isChord })
  }

  const result = {}
  for (const [voiceName, notes] of Object.entries(byVoice)) {
    for (let i = 0; i < notes.length; i++) {
      if (notes[i]._isChord) {
        notes[i].chord = true
        if (i > 0) notes[i - 1].chord = true
      }
      delete notes[i]._isChord
    }
    result[voiceName] = notes
  }

  return result
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getTextContent(node, selector) {
  return node.querySelector(selector)?.textContent?.trim() || ''
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}
