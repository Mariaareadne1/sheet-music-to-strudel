const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY
const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-20250514'

const SYSTEM_PROMPT = `You are an expert music transcription assistant that converts sheet music into Strudel live coding syntax.

When given an image of sheet music, you must:
1. Identify the time signature (default 4/4 if unclear)
2. Identify the BPM/tempo marking (default 120 if unclear)
3. Identify all voices/staves (treble clef, bass clef, etc.)
4. Read every measure carefully, noting pitches and rhythmic durations
5. Return ONLY a valid JSON object — no markdown, no explanation, no code fences

Duration mappings:
- whole note = "@4" (lasts 4 units)
- half note = "@2" (lasts 2 units)
- quarter note = no modifier (1 unit)
- eighth note = part of a [subdivision] group
- sixteenth note = part of a nested [[subdivision]] group
- dotted quarter = "@1.5"
- rest = "~"

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
            {"pitch": "c4", "duration": "half"}
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
- Use lowercase letter + octave number: c4, d4, e4, f4, g4, a4, b4
- Sharps: c#4, d#4, f#4, g#4, a#4
- Flats: db4, eb4, gb4, ab4, bb4
- Middle C = c4
- If a stave is missing (e.g. only treble clef), omit the missing key from the measure object`

/**
 * Calls the Claude API with one or more page images.
 * Returns parsed JSON from the model response.
 */
export async function callClaudeAPI(images) {
  if (!API_KEY) {
    throw new Error('Missing VITE_ANTHROPIC_API_KEY. Add it to your .env file.')
  }

  const content = [
    ...images.map(({ base64, mediaType }) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64,
      },
    })),
    {
      type: 'text',
      text: 'Please transcribe all the sheet music in the image(s) above and return the JSON structure as specified.',
    },
  ]

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Claude API error ${response.status}: ${errText}`)
  }

  const data = await response.json()
  const rawText = data.content?.[0]?.text ?? ''

  // Strip any accidental markdown fences
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    throw new Error(`Claude returned invalid JSON. Raw response:\n${rawText}`)
  }
}
