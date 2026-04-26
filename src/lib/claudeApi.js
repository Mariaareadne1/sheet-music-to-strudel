import { STRUDEL_SYNTAX_REFERENCE } from './strudelCompiler.js'
import {
  preprocessScore,
  detectStaffLines,
  detectBarlines,
  cropMeasures,
  findRecurringPatterns,
} from './scoreAnalyzer.js'

const API_KEY    = import.meta.env.VITE_ANTHROPIC_API_KEY
const API_URL    = 'https://api.anthropic.com/v1/messages'
const MODEL      = 'claude-sonnet-4-20250514'
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

// ── System prompt (FIX 2 — exact copy as specified) ───────────────────────────

const SYSTEM_PROMPT = `IMPORTANT: You must complete your entire JSON response. Never stop mid-object. If the score is very long and you are worried about running out of space, transcribe fewer measures but always output complete, valid, parseable JSON. It is better to transcribe 4 complete measures than 20 incomplete ones. Always close every bracket and brace before finishing.

You are a world-class music transcription engine. You read sheet music images with perfect accuracy and return structured JSON. You have deep knowledge of music notation and the Strudel live coding language.

=== WHAT YOU MUST DO ===

1. Read EVERY note in the score. Do not skip, approximate, or hallucinate.
2. Read notes from left to right, top staff first (treble), then bottom staff (bass).
3. Read the actual tempo marking if present. If not, estimate: classical=80-100, pop/rock=100-130, fast dance=130-160.
4. Identify the key signature and account for it when naming pitches. For example if there are 4 sharps (E major / C# minor), all F, C, G, D notes are sharp unless marked natural.
5. Read the time signature (4/4, 3/4, 6/8 etc).
6. Never leave long stretches of rests in the bass clef unless the score literally shows whole-measure rests there.
7. For fast 16th/32nd note runs: read every single note individually — do not repeat a pattern, do not guess.
8. For chords (multiple noteheads on the same stem): list them as separate entries with the same duration and add "chord": true to each chord note so they can be played simultaneously.
9. If a note is tied to the next note, combine their durations into one note entry.
10. For repeats (:|:), include the repeated section twice in the measures array.
11. If there are multiple pages, read all of them in sequence.

=== DURATION VALUES — use exactly these strings ===

"whole"           = whole note (4 beats in 4/4)
"dotted_half"     = dotted half note (3 beats)
"half"            = half note (2 beats)
"dotted_quarter"  = dotted quarter note (1.5 beats)
"quarter"         = quarter note (1 beat)
"dotted_eighth"   = dotted eighth note (0.75 beats)
"eighth"          = eighth note (0.5 beats)
"dotted_sixteenth"= dotted sixteenth (0.375 beats)
"sixteenth"       = sixteenth note (0.25 beats)
"thirty_second"   = 32nd note (0.125 beats)
"quarter_triplet" = quarter note triplet (2/3 of a beat, 3 fill 2 beats)
"eighth_triplet"  = eighth note triplet (1/3 of a beat, 3 fill 1 beat)
"sixteenth_triplet" = sixteenth triplet (3 fill half a beat)

For rests: use pitch "rest" with any of the above durations.

=== PITCH NAMING — use exactly these formats ===

- Always include octave: c4, d4, e4, f4, g4, a4, b4
- Middle C = c4. C above middle C = c5. C below middle C = c3.
- Sharps: add # — f#4, c#5, g#3, a#4, d#4
- Flats: add b — bb3, eb4, ab3, db4, gb4
- Naturals: if a note is marked natural in a sharp/flat key, write it without accidental
- For chords, list each pitch as its own object with the same duration and "chord": true

=== WHAT GOOD OUTPUT LOOKS LIKE ===

For a measure of 4/4 with a melody run of 8 sixteenth notes then a half note:
"treble": [
  {"pitch": "f#5", "duration": "sixteenth"},
  {"pitch": "e5", "duration": "sixteenth"},
  {"pitch": "d5", "duration": "sixteenth"},
  {"pitch": "c#5", "duration": "sixteenth"},
  {"pitch": "b4", "duration": "sixteenth"},
  {"pitch": "a4", "duration": "sixteenth"},
  {"pitch": "g#4", "duration": "sixteenth"},
  {"pitch": "f#4", "duration": "sixteenth"},
  {"pitch": "e4", "duration": "half"}
]

For a bass clef measure with a chord on beat 1 and walking bass:
"bass": [
  {"pitch": "d2", "duration": "quarter", "chord": true},
  {"pitch": "f#3", "duration": "quarter", "chord": true},
  {"pitch": "a3", "duration": "quarter", "chord": true},
  {"pitch": "e3", "duration": "eighth"},
  {"pitch": "f#3", "duration": "eighth"}
]

For a triplet:
{"pitch": "c4", "duration": "eighth_triplet"},
{"pitch": "e4", "duration": "eighth_triplet"},
{"pitch": "g4", "duration": "eighth_triplet"}

=== RETURN FORMAT ===

Return ONLY raw JSON. No markdown fences. No explanation. No commentary. Start with { and end with }.

{
  "bpm": 123,
  "timeSignature": [4, 4],
  "title": "Detected title or Unknown",
  "key": "E major",
  "sections": [
    {
      "name": "intro",
      "measures": [
        {
          "treble": [
            {"pitch": "f#5", "duration": "sixteenth"},
            {"pitch": "e5", "duration": "sixteenth"}
          ],
          "bass": [
            {"pitch": "b2", "duration": "half"},
            {"pitch": "f#3", "duration": "half"}
          ]
        }
      ]
    }
  ]
}

If only one clef is present (e.g. violin part, single melody line), only include "treble". Omit "bass" entirely.
If there are more than two staves (e.g. full ensemble), add "staff3", "staff4" etc.

${STRUDEL_SYNTAX_REFERENCE}`

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full transcription pipeline:
 *   1. detectKeyAndTime  — fast Haiku call to lock in key + time signature
 *   2. scoreAnalyzer     — local Canvas-API visual pattern map
 *   3. getScoreDescription — Haiku pass 1: verbal score structure
 *   4. Main Sonnet call  — pass 2: full JSON with injected context
 *
 * @param {Array<{base64: string, mediaType: string}>} images
 * @param {function(number, string=): void} onProgress  — called with 0-100 + optional label
 * @returns {Promise<{json: object, patternMap: object}>}
 */
export async function callClaudeAPI(images, onProgress = () => {}) {
  if (!API_KEY) {
    throw new Error(
      'Missing VITE_ANTHROPIC_API_KEY — copy .env.example to .env and add your key.'
    )
  }

  // ── Step 1: Key/time pre-detection (fast Haiku call) ─────────────────────
  const keyTimeInfo = await detectKeyAndTime(images)
  onProgress(8, 'Detecting key signature...')

  // ── Step 2: Visual pattern analysis (local Canvas API) ───────────────────
  let patternMap = {}
  try {
    const scoreData  = await preprocessScore(images[0].base64, images[0].mediaType)
    const staffLines = detectStaffLines(scoreData)
    const barlines   = detectBarlines(scoreData, staffLines)
    const crops      = cropMeasures(scoreData, staffLines, barlines)
    patternMap       = await findRecurringPatterns(crops)
  } catch (e) {
    console.warn('[Sheet Music to Strudel] Score analysis skipped (non-fatal):', e.message)
  }
  onProgress(18, 'Mapping score structure...')

  // ── Step 3: Pass 1 — verbal score description (Haiku) ────────────────────
  const description = await getScoreDescription(images, keyTimeInfo)
  onProgress(45, 'Reading score structure...')

  // ── Step 4: Pass 2 — full JSON transcription (Sonnet) ────────────────────
  const metaLines = [
    keyTimeInfo ? `CONFIRMED SCORE METADATA: ${keyTimeInfo}` : '',
    description ? `SCORE STRUCTURE SUMMARY: ${description}` : '',
  ].filter(Boolean)

  const systemPrompt = metaLines.length
    ? `${metaLines.join('\n')}\n\n${SYSTEM_PROMPT}`
    : SYSTEM_PROMPT

  const content = [
    ...images.map(({ base64, mediaType }) => ({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    })),
    {
      type: 'text',
      text: 'Transcribe all the sheet music in the above image(s). Return the JSON structure exactly as specified in the system prompt.\nCRITICAL: Return complete valid JSON only. If the score is too long to fully transcribe, transcribe as many complete measures as fit, then close all brackets properly. Never cut off mid-value.',
    },
  ]

  let response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-api-key':     API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 8000,
        system:     systemPrompt,
        messages:   [{ role: 'user', content }],
      }),
    })
  } catch (netErr) {
    throw new Error(
      `Network error — could not reach the Claude API.\n` +
      `Check your internet connection.\n(${netErr.message})`
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const hint =
      response.status === 401 ? ' (invalid or missing API key)' :
      response.status === 429 ? ' (rate-limited — wait a moment and try again)' :
      response.status >= 500  ? ' (Claude server error — try again shortly)' :
      ''
    throw new Error(`Claude API returned HTTP ${response.status}${hint}.\n${body}`)
  }

  const data    = await response.json()
  const rawText = data.content?.[0]?.text ?? ''

  onProgress(95, 'Finalizing transcription...')

  const json = extractAndValidateJSON(rawText)
  return { json, patternMap }
}

// ── Pre-detection helpers ─────────────────────────────────────────────────────

/**
 * Fast Haiku call: detects key signature and time signature from the first image.
 * Returns a compact string like "Key: E major | Time: 4/4", or null on any failure.
 */
async function detectKeyAndTime(images) {
  try {
    const content = [
      { type: 'image', source: { type: 'base64', media_type: images[0].mediaType, data: images[0].base64 } },
      { type: 'text',  text: 'Look at this sheet music. Reply in one line only: "Key: [key] | Time: [N/N]". Example: "Key: E major | Time: 4/4". If key unknown write "Key: Unknown". Nothing else.' },
    ]
    const res = await fetch(API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-api-key':     API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: HAIKU_MODEL, max_tokens: 80, messages: [{ role: 'user', content }] }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.content?.[0]?.text ?? '').trim() || null
  } catch {
    return null
  }
}

/**
 * Pass 1: Haiku call that returns a short verbal description of the score's
 * structure.  Injected into the Sonnet system prompt as priming context.
 */
async function getScoreDescription(images, keyTimeInfo) {
  try {
    const hint = keyTimeInfo ? `Known metadata: ${keyTimeInfo}. ` : ''
    const content = [
      ...images.map(({ base64, mediaType }) => ({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      })),
      {
        type: 'text',
        text: `${hint}In 2-3 sentences describe this sheet music's structure: number of measures, how many distinct sections or visually repeated passages, what clefs/voices are present, and any notable complexity (runs, chords, triplets). Be specific about repeated measure patterns.`,
      },
    ]
    const res = await fetch(API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-api-key':     API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: HAIKU_MODEL, max_tokens: 300, messages: [{ role: 'user', content }] }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.content?.[0]?.text ?? '').trim() || null
  } catch {
    return null
  }
}

// ── JSON extraction helpers ───────────────────────────────────────────────────

/**
 * Tries four increasingly-permissive strategies to extract valid JSON from
 * Claude's raw text output, then validates and normalises the structure.
 *
 * Strategy 1: strip markdown fences, parse directly.
 * Strategy 2: extract the first {...} block via regex.
 * Strategy 3: slice from the first '{' character.
 * Strategy 4: run repairTruncatedJSON on the sliced string and try again.
 *             This handles responses cut off mid-value by a max_tokens limit.
 */
function extractAndValidateJSON(rawText) {
  // Strategy 1 — strip optional markdown fences and try a direct parse
  const stripped = rawText
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m,  '')
    .trim()

  let parsed = tryParse(stripped)

  // Strategy 2 — pull out the first complete {...} block
  if (!parsed) {
    const m = rawText.match(/\{[\s\S]*\}/)
    if (m) parsed = tryParse(m[0])
  }

  // Strategy 3 — drop any leading prose before the first '{'
  const fromBrace = rawText.slice(rawText.indexOf('{'))
  if (!parsed && rawText.includes('{')) {
    parsed = tryParse(fromBrace)
  }

  // Strategy 4 — attempt to close a truncated JSON string, then parse
  if (!parsed && rawText.includes('{')) {
    parsed = tryParse(repairTruncatedJSON(fromBrace))
  }

  if (!parsed) {
    throw new Error(
      `Claude's response could not be parsed as JSON.\n\n` +
      `Raw response (first 600 chars):\n${rawText.slice(0, 600)}`
    )
  }

  return validateAndNormalise(parsed)
}

/** JSON.parse wrapper that returns null instead of throwing on invalid input. */
function tryParse(str) {
  try { return JSON.parse(str) } catch { return null }
}

/**
 * Attempts to salvage a JSON string that was cut off mid-stream (e.g. because
 * max_tokens was reached).  Works by walking the string character-by-character,
 * tracking open brackets/braces and string state, then appending the missing
 * closing characters in reverse stack order.
 *
 * This is a best-effort repair — it cannot recover lost note data, but it
 * allows the compiler to work with whatever measures were fully written out
 * before the response was truncated.
 *
 * @param {string} str  Potentially-truncated JSON string
 * @returns {string}    The input with missing closing tokens appended
 */
function repairTruncatedJSON(str) {
  let result = str.trim()

  // Remove a trailing comma that would make the JSON invalid after we close it
  result = result.replace(/,\s*$/, '')

  // Walk the string tracking open structures and string literal state
  const stack    = []
  let inString   = false
  let escape     = false

  for (const ch of result) {
    if (escape)                        { escape = false; continue }
    if (ch === '\\' && inString)       { escape = true;  continue }
    if (ch === '"')                    { inString = !inString; continue }
    if (inString)                        continue
    if      (ch === '{')               stack.push('}')
    else if (ch === '[')               stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }

  // Close every open structure in LIFO order
  while (stack.length) result += stack.pop()

  return result
}

/**
 * Validates the parsed object has the expected music structure and applies
 * safe defaults.  Attempts to auto-repair the two most common Claude mistakes:
 *
 *   1. Measures returned at the top level (no sections wrapper).
 *   2. A single measure object returned directly instead of an array.
 *
 * Throws a descriptive Error if the structure is unrecoverable.
 */
function validateAndNormalise(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Claude returned a non-object JSON value — expected a music object.')
  }

  const bpm           = Number(json.bpm) || 120
  const timeSignature = Array.isArray(json.timeSignature) ? json.timeSignature : [4, 4]
  const title         = typeof json.title === 'string' ? json.title : 'Unknown'
  const key           = typeof json.key   === 'string' ? json.key   : ''

  let sections = json.sections

  if (!Array.isArray(sections)) {
    if (Array.isArray(json.measures)) {
      // Repair: measures at top level
      sections = [{ name: 'main', measures: json.measures }]
    } else if (json.treble || json.bass) {
      // Repair: single measure object at top level
      sections = [{ name: 'main', measures: [json] }]
    } else {
      throw new Error(
        `Claude's JSON is missing the "sections" array and could not be repaired.\n` +
        `Keys present: ${Object.keys(json).join(', ')}`
      )
    }
  }

  const validSections = sections.filter(
    s => s && Array.isArray(s.measures) && s.measures.length > 0
  )

  if (validSections.length === 0) {
    throw new Error(
      'Claude returned sections with no measures — the sheet music may not have been recognised.'
    )
  }

  return { bpm, timeSignature, title, key, sections: validSections }
}

// ── Second-pass Claude validation ─────────────────────────────────────────────

const VALIDATION_SYSTEM_PROMPT = `You are a Strudel syntax validator. The user will give you a piece of Strudel code. Check it for these specific errors:
1. Any @0.5, @0.25, @0.125 modifiers — replace with proper bracket notation
2. Any .slow() on a note() pattern — remove it and adjust the /N number instead
3. Any mismatched brackets [ ] or angle brackets < >
4. Any MIDI numbers (integers like 48, 60, 72) instead of note names — convert to note names
5. Any empty patterns like note("")

Return ONLY the corrected Strudel code. No explanation. No markdown fences. Just the raw corrected code starting with // Generated by Sheet Music to Strudel`

/**
 * Sends the generated Strudel code to a fast Haiku model for a second syntax
 * validation pass.  Uses cheap/fast Haiku to keep latency and cost low.
 *
 * This is best-effort: if the call fails for any reason the original code is
 * returned unchanged so the user always gets something playable.
 *
 * @param {string} code  Strudel code from compileToStrudel()
 * @returns {Promise<string>} Validated (possibly corrected) Strudel code
 */
export async function validateCodeWithClaude(code) {
  if (!API_KEY) return code

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      HAIKU_MODEL,
        max_tokens: 2000,
        system:     VALIDATION_SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: code }],
      }),
    })

    if (!response.ok) {
      console.warn(`[Sheet Music to Strudel] Validation call failed (HTTP ${response.status}) — using original code`)
      return code
    }

    const data      = await response.json()
    const validated = (data.content?.[0]?.text ?? '').trim()

    // Sanity-check: the response must look like Strudel code
    if (validated && (validated.includes('setcps(') || validated.includes('$:'))) {
      return validated
    }

    console.warn('[Sheet Music to Strudel] Validation response did not look like Strudel code — using original')
    return code
  } catch (err) {
    console.warn('[Sheet Music to Strudel] Validation call threw — using original code:', err.message)
    return code
  }
}
