// Two-pass Tesseract OCR for receipts.
//
// Pass A: "main" pass. Default English, with a char blacklist for
// currency glyphs that are common digit-misreads on US receipts
// (£, §, ¥, ¢). Produces full word-level layout.
//
// Pass B: "rescue" pass. Digit-focused (whitelist of 0-9 and price
// punctuation) with PSM = SINGLE_BLOCK. Catches price digits the main
// pass miscategorised as letters.
//
// Tesseract.js 7 persists parameters across `recognize()` calls on the
// same worker. Mixing a digit-only whitelist with a letter blacklist
// silently corrupts subsequent passes, so we use TWO worker instances
// — one dedicated to each config.

import type { Worker } from 'tesseract.js'
import type {
  CachedOcr,
  OcrLine,
  OcrPassData,
  OcrWord,
} from './parseReceiptV2'

export interface OcrProgress {
  status: string
  progress: number
}

// Local minimal view of Tesseract.js output shape. We don't want a
// hard dependency on tesseract.js's internal types — they change across
// versions — so we just declare what we read.
interface TessBbox {
  x0: number
  y0: number
  x1: number
  y1: number
}
interface TessWord {
  text: string
  bbox: TessBbox
  confidence?: number
}
interface TessLine {
  text: string
  bbox: TessBbox
  confidence?: number
  words?: TessWord[]
}
interface TessParagraph {
  lines?: TessLine[]
}
interface TessBlock {
  paragraphs?: TessParagraph[]
}
interface TessRecognizeData {
  text: string
  blocks?: TessBlock[]
}

/** Flatten Tesseract's blocks→paragraphs→lines nesting into one array. */
function simplifyPass(data: TessRecognizeData): OcrPassData {
  const lines: OcrLine[] = []
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const words: OcrWord[] = (line.words ?? []).map((w) => ({
          text: w.text,
          bbox: w.bbox,
        }))
        lines.push({
          text: line.text,
          bbox: line.bbox,
          words,
        })
      }
    }
  }
  return { text: data.text, lines }
}

// ── Worker lifecycle ──

interface OcrSession {
  mainWorker: Worker
  rescueWorker: Worker
}

let session: OcrSession | null = null
// Separate "pending" promise so concurrent callers share a single load.
let sessionPromise: Promise<OcrSession> | null = null

async function getSession(
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrSession> {
  if (session) return session
  if (sessionPromise) return sessionPromise

  sessionPromise = (async () => {
    // Dynamic import keeps tesseract.js out of the initial bundle (the
    // whole point of lazy-loading it).
    const tesseract = await import('tesseract.js')
    const { createWorker, PSM } = tesseract

    const logger = (m: { status: string; progress: number }) => {
      if (!onProgress) return
      if (m.status === 'recognizing text') {
        onProgress({
          status: 'Recognizing text...',
          progress: Math.round(m.progress * 100),
        })
      } else if (m.status === 'loading language traineddata') {
        onProgress({
          status: 'Downloading language data...',
          progress: Math.round(m.progress * 100),
        })
      }
    }

    const mainWorker = await createWorker('eng', 1, { logger })
    // Currency/typography glyphs that never appear on US restaurant
    // receipts but are common Tesseract misreads of digits (e.g. "6"
    // → "£", "8" → "§"). Keeping these out was already in prod.
    await mainWorker.setParameters({
      tessedit_char_blacklist: '£§¥¢',
    })

    const rescueWorker = await createWorker('eng', 1, { logger })
    await rescueWorker.setParameters({
      tessedit_char_whitelist: '0123456789$.,() -',
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    })

    const s = { mainWorker, rescueWorker }
    session = s
    return s
  })()

  try {
    return await sessionPromise
  } finally {
    sessionPromise = null
  }
}

/** Tear down both workers. Safe to call even if nothing was loaded. */
export async function disposeOcrEngine(): Promise<void> {
  const s = session
  session = null
  if (s) {
    await Promise.all([
      s.mainWorker.terminate().catch(() => {}),
      s.rescueWorker.terminate().catch(() => {}),
    ])
  }
}

/**
 * Run both Tesseract passes on the given image and return word-level
 * layout data suitable for `parseReceiptV2`.
 *
 * Progress updates are driven by the main pass only; the rescue pass
 * is reported as a single "Refining prices…" status so the user sees
 * two distinct phases rather than a jumping bar.
 */
export async function recognizeReceipt(
  image: File | Blob | string,
  onProgress?: (p: OcrProgress) => void,
): Promise<CachedOcr> {
  const s = await getSession(onProgress)

  onProgress?.({ status: 'Recognizing text...', progress: 0 })
  const mainRaw = await s.mainWorker.recognize(image, {}, { blocks: true })
  onProgress?.({ status: 'Refining prices...', progress: 0 })
  const rescueRaw = await s.rescueWorker.recognize(image, {}, { blocks: true })
  onProgress?.({ status: 'Parsing...', progress: 100 })

  return {
    main: simplifyPass(mainRaw.data as TessRecognizeData),
    rescue: simplifyPass(rescueRaw.data as TessRecognizeData),
  }
}
