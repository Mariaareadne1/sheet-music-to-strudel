const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY
const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL   = 'claude-sonnet-4-20250514'

/**
 * System prompt sent with every request.
 *
 * Instructs Claude to return a single, strictly-valid JSON object describing
 * the music.  Duration strings are chosen so the compiler can map them
 * directly to Strudel @-modifier syntax without any ambiguity.
 */
const SYSTEM_PROMPT = `You are an expert music transcription assistant that converts sheet music into Strudel live coding syntax.

When given an image of sheet music, you must:
1. Identify the time signature (default 4/4 if unclear)
2. Identify the BPM/tempo marking (default 120 if unclear)
3. Identify all voices/staves (treble clef, bass clef, etc.)
4. Read every measure carefully, noting pitches and rhythmic durations
5. Return ONLY a valid JSON object — no markdown, no explanation, no code fences

Duration strings to use:
- "whole"            – whole note (4 beats)
- "dotted_whole"     – dotted whole (6 beats)
- "half"             – half note (2 beats)
- "dotted_half"      – dotted half (3 beats)
- "quarter"          – quarter note (1 beat)
- "dotted_quarter"   – dotted quarter (1.5 beats)
- "eighth"           – eighth note (0.5 beats)
- "dotted_eighth"    – dotted eighth (0.75 beats)
- "sixteenth"        – sixteenth note (0.25 beats)
- "triplet_quarter"  – quarter-note triplet (one of three spanning 2 beats)
- "triplet_eighth"   – eighth-note triplet (one of three spanning 1 beat)
- "rest"             – use as the pitch value for any rest, duration stays as above

Ties: add "tied": true to a note when it is tied TO the following note of the same pitch.

Return this exact JSON structure:
{
  "bpm": 120,
  "timeSignature": [4, 4],
  "title": "detected title or Unknown",
  "sections": [
    {
      "name": "main",
      "measures": [
        {
          "treble": [
            {"pitch": "e4", "duration": "quarter"},
            {"pitch": "rest", "duration": "quarter"},
            {"pitch": "c4", "duration": "half", "tied": true},
            {"pitch": "c4", "duration": "quarter"}
          ],
          "bass": [
            {"pitch": "c3", "duration": "whole"}
          ]
        }
      ]
    }
  ]
}

Pitch naming rules:
- Lowercase letter + octave: c4, d4, e4, f4, g4, a4, b4
- Sharps: c#4, d#4, f#4, g#4, a#4
- Flats:  db4, eb4, gb4, ab4, bb4
- Middle C = c4
- Omit a stave key from the measure object if that stave is absent`

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sends one or more page images to Claude and returns a validated music JSON.
 *
 * @param {Array<{base64: string, mediaType: string}>} images
 * @returns {Promise<object>} Validated music JSON ready for compileToStrudel()
 * @throws {Error} If the API call fails or the response cannot be parsed
 */
export async function callClaudeAPI(images) {
  if (!API_KEY) {
    throw new Error(
      'Missing VITE_ANTHROPIC_API_KEY — add it to your .env file (copy .env.example).'
    )
  }

  // Build the message content: one image block per page, then a text prompt.
  const content = [
    ...images.map(({ base64, mediaType }) => ({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    })),
    {
      type: 'text',
      text: 'Transcribe all sheet music in the image(s) above and return the JSON structure as specified.',
    },
  ]

  let response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        // Required header for direct browser-to-API calls (no backend proxy)
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    })
  } catch (networkErr) {
    throw new Error(
      `Network error — could not reach the Claude API. Check your internet connection.\n(${networkErr.message})`
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const hint = response.status === 401
      ? ' (invalid or missing API key)'
      : response.status === 429
      ? ' (rate limit — wait a moment and try again)'
      : response.status >= 500
      ? ' (Claude API server error — try again shortly)'
      : ''
    throw new Error(`Claude API returned ${response.status}${hint}.\n${body}`)
  }

  const data    = await response.json()
  const rawText = data.content?.[0]?.text ?? ''

  // Parse and validate; throws with a helpful message on failure.
  return extractAndValidateJSON(rawText)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Tries multiple strategies to extract valid JSON from the model's raw text
 * output, then validates and normalises the structure.
 *
 * Strategy order:
 *   1. Strip markdown fences, parse directly.
 *   2. Extract the first {...} block with a regex.
 *   3. Drop everything before the first '{'.
 *
 * After a successful parse, validateAndNormalise() checks required fields and
 * attempts to auto-repair common structural issues (e.g. Claude returning
 * measures at the top level instead of inside sections).
 *
 * @param {string} rawText
 * @returns {object} Normalised music JSON
 * @throws {Error} If all extraction strategies fail
 */
function extractAndValidateJSON(rawText) {
  // Strategy 1 – strip markdown fences and try a direct parse
  const stripped = rawText
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  let parsed = tryParse(stripped)

  // Strategy 2 – pull out the first {...} block
  if (!parsed) {
    const match = rawText.match(/\{[\s\S]*\}/)
    if (match) parsed = tryParse(match[0])
  }

  // Strategy 3 – drop any prose before the first '{'
  if (!parsed) {
    const start = rawText.indexOf('{')
    if (start !== -1) parsed = tryParse(rawText.slice(start))
  }

  if (!parsed) {
    throw new Error(
      `Claude's response could not be parsed as JSON.\n\n` +
      `Raw response (first 600 chars):\n${rawText.slice(0, 600)}`
    )
  }

  return validateAndNormalise(parsed)
}

/** JSON.parse wrapper that returns null instead of throwing. */
function tryParse(str) {
  try { return JSON.parse(str) } catch { return null }
}

/**
 * Validates that the parsed object has the expected music structure and fills
 * in safe defaults for missing optional fields.
 *
 * Handles one common Claude mistake: returning measures at the top level
 * (or inside a single object without a sections array) by wrapping them.
 *
 * @param {object} json
 * @returns {object} Normalised music JSON
 * @throws {Error} If the structure is unrecoverable
 */
function validateAndNormalise(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Claude returned a non-object JSON value — expected a music object.')
  }

  // Apply safe defaults for top-level fields
  const bpm            = Number(json.bpm)  || 120
  const timeSignature  = Array.isArray(json.timeSignature) ? json.timeSignature : [4, 4]
  const title          = typeof json.title === 'string' ? json.title : 'Unknown'

  let sections = json.sections

  // Auto-repair: if sections is missing but measures is present, wrap it
  if (!Array.isArray(sections)) {
    if (Array.isArray(json.measures)) {
      sections = [{ name: 'main', measures: json.measures }]
    } else if (json.treble || json.bass) {
      // Claude returned a single measure at the top level
      sections = [{ name: 'main', measures: [json] }]
    } else {
      throw new Error(
        `Claude's JSON is missing the "sections" array and no auto-repair was possible.\n` +
        `Received keys: ${Object.keys(json).join(', ')}`
      )
    }
  }

  // Validate that each section has a measures array; skip empty sections
  const validSections = sections
    .filter(s => s && Array.isArray(s.measures) && s.measures.length > 0)

  if (validSections.length === 0) {
    throw new Error('Claude returned sections with no measures — the sheet music may not have been recognised.')
  }

  return { bpm, timeSignature, title, sections: validSections }
}
