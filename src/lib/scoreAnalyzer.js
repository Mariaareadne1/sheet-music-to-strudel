/**
 * scoreAnalyzer.js
 *
 * Browser-side algorithmic analysis of sheet music images using the Canvas API.
 * Provides visual pre-processing hints that help claudeApi.js identify repeated
 * measure patterns before making API calls.
 *
 * All functions catch their own errors and return safe defaults so pipeline
 * failures here are non-fatal.
 */

/**
 * Loads a base64 image onto an offscreen canvas and returns the drawing context.
 * @param {string} base64     Base64-encoded image data (no data: prefix)
 * @param {string} mediaType  e.g. 'image/jpeg' or 'image/png'
 * @returns {Promise<{canvas, ctx, width, height}>}
 */
export function preprocessScore(base64, mediaType) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      resolve({ canvas, ctx, width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = reject
    img.src = `data:${mediaType};base64,${base64}`
  })
}

/**
 * Detects horizontal staff lines by finding rows where most pixels are dark.
 * Returns de-duplicated y-coordinates.
 *
 * @param {{ ctx, width, height }} scoreData
 * @returns {number[]}
 */
export function detectStaffLines({ ctx, width, height }) {
  try {
    const { data } = ctx.getImageData(0, 0, width, height)
    const lines = []
    for (let y = 0; y < height; y++) {
      let dark = 0
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 80) dark++
      }
      if (dark / width >= 0.55) lines.push(y)
    }
    return collapseRuns(lines, 2)
  } catch {
    return []
  }
}

/**
 * Detects vertical barlines within the staff region.
 * Returns de-duplicated x-coordinates.
 *
 * @param {{ ctx, width, height }} scoreData
 * @param {number[]} staffLines
 * @returns {number[]}
 */
export function detectBarlines({ ctx, width, height }, staffLines) {
  try {
    if (staffLines.length < 2) return []
    const topY    = Math.max(0, staffLines[0] - 4)
    const bottomY = Math.min(height - 1, staffLines[staffLines.length - 1] + 4)
    const spanH   = bottomY - topY
    if (spanH < 1) return []

    const { data } = ctx.getImageData(0, 0, width, height)
    const cols = []
    for (let x = 0; x < width; x++) {
      let dark = 0
      for (let y = topY; y <= bottomY; y++) {
        const i = (y * width + x) * 4
        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 80) dark++
      }
      if (dark / spanH >= 0.45) cols.push(x)
    }
    return collapseRuns(cols, 3)
  } catch {
    return []
  }
}

/**
 * Crops individual measure regions between consecutive barlines.
 * Returns one base64 JPEG string per detected measure.
 *
 * @param {{ canvas, width, height }} scoreData
 * @param {number[]} staffLines
 * @param {number[]} barlines
 * @returns {string[]}
 */
export function cropMeasures({ canvas, width, height }, staffLines, barlines) {
  try {
    if (barlines.length < 2) return []
    const topY    = Math.max(0, (staffLines[0] ?? 0) - 8)
    const bottomY = Math.min(height, (staffLines[staffLines.length - 1] ?? height) + 8)
    const crops   = []

    for (let i = 0; i < barlines.length - 1; i++) {
      const x1 = barlines[i]
      const x2 = barlines[i + 1]
      const w  = x2 - x1
      const h  = bottomY - topY
      if (w < 15 || h < 15) continue
      const tmp = document.createElement('canvas')
      tmp.width  = w
      tmp.height = h
      tmp.getContext('2d').drawImage(canvas, x1, topY, w, h, 0, 0, w, h)
      crops.push(tmp.toDataURL('image/jpeg', 0.7).split(',')[1])
    }
    return crops
  } catch {
    return []
  }
}

/**
 * Groups measure crops by visual similarity using 16×16 grayscale thumbnails.
 * Returns { measureIndex: 'A' | 'B' | ... } for up to 26 distinct patterns.
 *
 * @param {string[]} measureCrops  Base64 JPEG strings from cropMeasures
 * @returns {Promise<Object>}
 */
export async function findRecurringPatterns(measureCrops) {
  try {
    if (measureCrops.length === 0) return {}
    const thumbs = await Promise.all(measureCrops.map(toGrayThumb))
    const THRESHOLD = 22
    const patternMap = {}
    const reps = []
    let nextCode = 0

    for (let i = 0; i < thumbs.length; i++) {
      let found = null
      for (const rep of reps) {
        if (thumbDiff(thumbs[i], rep.thumb) < THRESHOLD) { found = rep.id; break }
      }
      if (found === null) {
        found = String.fromCharCode(65 + (nextCode % 26))
        reps.push({ id: found, thumb: thumbs[i] })
        nextCode++
      }
      patternMap[i] = found
    }
    return patternMap
  } catch {
    return {}
  }
}

/**
 * Estimates whether notes extend above or below the staff in a measure region.
 *
 * @param {{ ctx, width, height }} scoreData
 * @param {number[]} staffLines
 * @param {number}   x1  Left boundary
 * @param {number}   x2  Right boundary
 * @returns {{ high: boolean, low: boolean }}
 */
export function estimateNotePositions({ ctx, width, height }, staffLines, x1, x2) {
  try {
    if (staffLines.length < 2) return { high: false, low: false }
    const topStaff    = staffLines[0]
    const bottomStaff = staffLines[staffLines.length - 1]
    const cx1 = Math.max(0, x1)
    const cx2 = Math.min(width, x2)
    const w   = cx2 - cx1
    if (w < 1) return { high: false, low: false }

    const { data } = ctx.getImageData(cx1, 0, w, height)
    let highDark = 0, lowDark = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < w; x++) {
        const idx  = (y * w + x) * 4
        const luma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
        if (luma < 80) {
          if (y < topStaff - 5)    highDark++
          if (y > bottomStaff + 5) lowDark++
        }
      }
    }
    return { high: highDark > 8, low: lowDark > 8 }
  } catch {
    return { high: false, low: false }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function collapseRuns(arr, gap = 2) {
  if (arr.length === 0) return []
  const groups = [[arr[0]]]
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] - arr[i - 1] <= gap) groups[groups.length - 1].push(arr[i])
    else groups.push([arr[i]])
  }
  return groups.map(g => g[Math.floor(g.length / 2)])
}

function toGrayThumb(base64) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = 16; c.height = 16
      c.getContext('2d').drawImage(img, 0, 0, 16, 16)
      const { data } = c.getContext('2d').getImageData(0, 0, 16, 16)
      const gray = []
      for (let i = 0; i < data.length; i += 4) {
        gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      }
      resolve(gray)
    }
    img.onerror = () => resolve(new Array(256).fill(128))
    img.src = `data:image/jpeg;base64,${base64}`
  })
}

function thumbDiff(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}
