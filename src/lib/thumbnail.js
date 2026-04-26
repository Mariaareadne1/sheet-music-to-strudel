/**
 * thumbnail.js
 *
 * Generates a 160×100 JPEG thumbnail from a base64 image string by drawing
 * it onto an offscreen <canvas> element.  The image is scaled to cover the
 * canvas while preserving aspect ratio (object-fit: cover behaviour).
 *
 * @param {string} base64   - Raw base64 string (no data: prefix)
 * @param {string} mediaType - MIME type, e.g. "image/jpeg"
 * @returns {Promise<string>} Base64 JPEG thumbnail (no data: prefix), quality 0.6
 */
export function createThumbnail(base64, mediaType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const W = 160
    const H = 100

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = W
      canvas.height = H
      const ctx = canvas.getContext('2d')

      // Scale to cover the canvas, keeping aspect ratio centered
      const scale = Math.max(W / img.width, H / img.height)
      const sw    = img.width  * scale
      const sh    = img.height * scale
      const sx    = (W - sw)  / 2
      const sy    = (H - sh)  / 2

      ctx.drawImage(img, sx, sy, sw, sh)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
      resolve(dataUrl.split(',')[1])
    }
    img.onerror = reject
    img.src = `data:${mediaType};base64,${base64}`
  })
}
