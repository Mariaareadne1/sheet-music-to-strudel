import * as pdfjs from 'pdfjs-dist'

// Point the worker at the bundled worker file served from node_modules
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

/**
 * Converts every page of a PDF File to base64 JPEG images.
 * Returns an array of { base64, mediaType } objects.
 */
export async function pdfToImages(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const images = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 2.0 })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')

    await page.render({ canvasContext: ctx, viewport }).promise

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const base64 = dataUrl.split(',')[1]
    images.push({ base64, mediaType: 'image/jpeg' })
  }

  return images
}
