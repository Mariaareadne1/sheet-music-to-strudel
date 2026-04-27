/**
 * history.js
 *
 * Manages the conversion history stored in localStorage under the key
 * "strudel_history".  Each entry contains the generated Strudel code, the
 * music metadata Claude detected, and a small thumbnail of the uploaded file.
 *
 * At most MAX_ENTRIES entries are kept; the oldest entry is dropped when the
 * list is full.
 */

const STORAGE_KEY  = 'strudel_history'
const MAX_ENTRIES  = 20

/**
 * Returns the full history array, newest first.
 * Returns an empty array if storage is empty or corrupted.
 */
export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

/**
 * Prepends a new entry to the history array and persists it.
 * Trims to MAX_ENTRIES if necessary.
 *
 * @param {{ title, bpm, timeSignature, key, code, thumbnail, source }} data
 *   source: 'musicxml' | 'ai'  — which conversion path was used
 * @returns {Array} The updated history array
 */
export function saveToHistory({ title, bpm, timeSignature, key, code, thumbnail, source }) {
  const entry = {
    id:            Date.now(),
    title:         title         ?? 'Unknown',
    bpm:           bpm           ?? 120,
    timeSignature: timeSignature ?? [4, 4],
    key:           key           ?? '',
    code:          code          ?? '',
    thumbnail:     thumbnail     ?? null,
    source:        source        ?? 'ai',
    timestamp:     new Date().toISOString(),
  }

  const updated = [entry, ...getHistory()].slice(0, MAX_ENTRIES)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch {
    // localStorage may be full; silently fail rather than breaking the app
  }
  return updated
}

/**
 * Removes the entry with the given id from history.
 * @returns {Array} Updated history array
 */
export function deleteHistoryEntry(id) {
  const updated = getHistory().filter(e => e.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  return updated
}

/**
 * Clears all history entries.
 * @returns {Array} Empty array
 */
export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY)
  return []
}

/**
 * Formats an ISO timestamp string into a human-readable relative label
 * ("Just now", "2 hours ago", "Jan 15", etc.).
 */
export function formatTimestamp(isoString) {
  const date  = new Date(isoString)
  const now   = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60_000)

  if (diffMins < 1)   return 'Just now'
  if (diffMins < 60)  return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24)   return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 7)   return `${diffDays}d ago`

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
