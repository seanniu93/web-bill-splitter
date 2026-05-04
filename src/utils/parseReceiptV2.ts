// Layout-aware receipt parser — V2.
//
// Takes the word-level output of one or two Tesseract passes (a main
// pass + an optional digit-focused "rescue" pass) and produces
// { name, price } pairs.
//
// Tuned against the 18-image `trainingdata/` corpus. Relative to the
// string-based V1 parser (`parseReceipt.ts`), V2 adds:
//
//   - Bbox-level price-column detection. The rightmost price candidate
//     on a line must land near the receipt's price column; mid-line
//     numeric tokens ("16.64 x 2") don't win.
//   - Number-word fusion across OCR-induced whitespace / overlapping
//     bboxes (e.g. "$0." + "00" → "$0.00") so "$0.00" modifiers aren't
//     silently lost.
//   - Quantity × unit-price fallback. When Tesseract eats the decimal
//     on the line total ("$7287" should be "$7.28") but the unit
//     price is intact ("7.28 x 1"), the computed total is used.
//   - Over-range ($>500) token rescue: tries dropping 1–2 leading
//     digits, so a "914,90" glued to a leading noise "9" recovers
//     "14.90" instead of being discarded.
//   - Conservative rescue-pass overlay: when a rescue-pass token
//     disagrees with the main pass AND agrees with the qty×unit
//     computation, the rescue value wins.
//
// Interface:
//   parseReceiptV2(cached) where `cached` is { main: PassData, rescue?:
//   PassData } and PassData is { text: string, lines: Line[] }. Each
//   Line has { text, bbox: {x0,y0,x1,y1}, words: Word[] } and each
//   Word has { text, bbox }. This matches the shape returned by
//   `simplifyTesseractData` in `ocrEngine.ts`.

import type { ParsedItem } from './parseReceipt'

export interface OcrBBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  bbox: OcrBBox
}

export interface OcrLine {
  text: string
  bbox: OcrBBox
  words: OcrWord[]
}

export interface OcrPassData {
  text: string
  lines: OcrLine[]
}

export interface CachedOcr {
  main: OcrPassData
  rescue?: OcrPassData
}

// ── Skip patterns (non-item line detection) ──
// Applied to the text LEFT of the matched price. If a price matches but
// the name portion looks like totals/tax/etc, skip.
const SKIP_PATTERNS: RegExp[] = [
  // `subtotal?` (the `?` being a regex modifier on the "l") is
  // intentional — OCR frequently reads "Subtotal" as "Subtota)" when
  // the trailing "l" is mistaken for ")". Matching with the "l"
  // optional catches both forms.
  /\bsub\s*totals?\b/i,
  /\bsubtotal?\b/i,
  /\btotals?\b/i,
  /\btota\)/i,
  /\btax\b/i,
  /\btip\b/i,
  /\bgratuity\b/i,
  /\bchange\b/i,
  /\bbalance\b/i,
  /\bvisa\b/i,
  /\bmastercard\b/i,
  /\bamex\b/i,
  /\bdisc(?:over|ount)?\b/i,
  /\bcash\b/i,
  /\bcard\b/i,
  /\bpayment\b/i,
  /\bthank\s*you\b/i,
  /\bguest\b/i,
  /\bserver\b/i,
  /\bcheck\s*#/i,
  /\btable\b/i,
  /\bdate\b/i,
  /\breceipt\b/i,
  /\bmerchant\b/i,
  /\bordered\b/i,
  /\bauthoriz/i,
  /\bapproval\b/i,
  /\btransaction\b/i,
  /\bapplication\b/i,
  /\ballergy\b/i,
  /\btime\b/i,
  /\blarge\s*party\b/i,
  /\bsuggested\b/i,
  /\btip\s*guide\b/i,
  /\bguide\b/i,
  /\bconvenience\b/i,
  /\binput\s*type\b/i,
  // Trailing tip-guide rows like "18% - 47.83"
  /\b\d{1,2}\s*%\s*[-–—~]\s*$/,
  /\bterminal\b/i,
  /\bregister\b/i,
  /\bcashier\b/i,
  /\bpowered\s*by\b/i,
  /\bsales\s*tax\b/i,
  /\bgrand\s*total\b/i,
  /\bcredit\b/i,
  /\bamount\b/i,
  /\bcopies?\b/i,
  /\bmerchant\s*copy\b/i,
  /\bcustomer\s*copy\b/i,
  /\bretain\b/i,
  /\bstatement\b/i,
  /\bvalidation\b/i,
  /\border\s*(id|number)\b/i,
  /\bticket\b/i,
  /\bitem\s*count\b/i,
  /\bemployee\b/i,
  /\boperator\b/i,
  /\bonsite\b/i,
  /\breference\b/i,
  /\bmethod\b/i,
  // NOTE: we intentionally do NOT skip `surcharge` on its own.
  // IMG_0746 has "5% Surcharge" as a legitimate line item. IMG_4972's
  // "Credit Card Surcharge" is already skipped via the `credit` rule.
  /\bitems?\s+subtotal\b/i,
  /\bauthoriz(e|ed)\s*amount/i,
  /^\s*drive\s*thru/i,
]

// A single word that looks like a currency amount. Optional $/£/(, 1–3
// digits with optional thousands, . or , decimal, 1–2 decimals,
// optional trailing )/$/}/] AND up to two trailing letters (Tesseract
// frequently glues a tax-flag "T" onto the price token).
const PRICE_TOKEN_RE =
  /^[$£(]?\s*(\d{1,3}(?:,\d{3})*[.,]\d{1,2})[)$}\]]?[A-Za-z]{0,2}$/

// ── Word fusion ──

/**
 * Check whether two words' bboxes are close enough to be considered
 * "adjacent" on the page. We tolerate substantial bbox overlap
 * (Tesseract has been observed to report overlapping bboxes for
 * adjacent tokens on noisy receipt photos — see IMG_6490 "$0." / "00")
 * as well as up to one character-width of positive gap.
 */
function areAdjacent(a: OcrWord, b: OcrWord): boolean {
  const h = Math.max(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0, 10)
  const yOverlap =
    Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0)
  if (yOverlap < h * 0.25) return false
  const gap = b.bbox.x0 - a.bbox.x1
  return gap >= -h && gap <= h * 1.2
}

/**
 * Fuse adjacent numeric words that together form one price.
 *   "$0." + "00"     →  "$0.00"
 *   "$0" + "." + "00" →  "$0.00"
 *   "1,234" + "." + "56" →  "1,234.56"
 * Non-numeric neighbours are left alone. Returns a new array of
 * "virtual" words with merged bboxes.
 */
function fuseNumberWords(words: OcrWord[]): OcrWord[] {
  const out: OcrWord[] = []
  let i = 0
  while (i < words.length) {
    const w: OcrWord = {
      text: words[i].text,
      bbox: { ...words[i].bbox },
    }
    while (i + 1 < words.length) {
      const nxt = words[i + 1]
      if (!areAdjacent(w, nxt)) break
      const merged = w.text + nxt.text
      const shouldMerge =
        // Both sides contain digits AND the merged result still looks
        // like it's heading toward a price.
        (/\d/.test(w.text) &&
          /\d/.test(nxt.text) &&
          /^[$£(]?[\d.,]+[.,]?[\d]*[)$}\]]?[A-Za-z]{0,2}$/.test(merged)) ||
        // OR one side ends/begins with a decimal separator.
        (/^[$£(]?[\d.,]+[.,]?$/.test(w.text) && /^[.,]?\d+$/.test(nxt.text)) ||
        w.text === '.' ||
        w.text === ',' ||
        nxt.text === '.' ||
        nxt.text === ','
      if (!shouldMerge) break
      w.text = merged
      w.bbox.x1 = nxt.bbox.x1
      w.bbox.y0 = Math.min(w.bbox.y0, nxt.bbox.y0)
      w.bbox.y1 = Math.max(w.bbox.y1, nxt.bbox.y1)
      i++
    }
    out.push(w)
    i++
  }
  return out
}

// ── Price parsing ──

/**
 * Parse a price token's text into cents. Returns null if not a valid
 * price. Tolerates trailing tax-flag letters, paren wrappers (treated
 * as negative → rejected), thousands-comma notation, and comma-decimal
 * notation.
 */
function parsePriceText(raw: string): number | null {
  const hasParens = /^\s*\(.*\)\s*$/.test(raw)
  let s = raw
    .replace(/[$£(){}\]]/g, '')
    // Strip at most two trailing letters (e.g. tax flag "T").
    .replace(/[A-Za-z]{1,2}$/, '')
    .trim()
  if (!s) return null
  // Strip thousands commas: "1,234.56" → "1234.56".
  if (/^\d{1,3}(?:,\d{3})+[.,]\d{1,2}$/.test(s)) {
    const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
    s = s.slice(0, lastSep).replace(/,/g, '') + s.slice(lastSep)
  }
  // Comma-decimal → dot-decimal.
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.')
  if (!/^\d+\.\d{1,2}$/.test(s)) return null
  // Pad single-decimal "16.5" to "16.50".
  if (/^\d+\.\d$/.test(s)) s += '0'
  const cents = Math.round(parseFloat(s) * 100)
  if (isNaN(cents) || cents < 0) return null
  if (hasParens) return null
  return cents
}

/**
 * Try to parse a token that's been glued to noise digit(s) on its left.
 * E.g. "914,90" (from "Prawns Rolls … fe 914,90" where the real price
 * is "14.90" and leading "9" is background noise). Only triggers when
 * the direct parse is implausibly large.
 */
function parsePriceTextWithFallback(raw: string): number | null {
  const direct = parsePriceText(raw)
  if (direct !== null && direct <= 50000) return direct
  if (direct !== null && direct > 50000) {
    for (let drop = 1; drop <= 2; drop++) {
      const m = raw.match(/^([$£(]?)(\d+)([.,]\d{1,2}.*)$/)
      if (!m) break
      if (m[2].length <= drop) break
      const shortened = m[1] + m[2].slice(drop) + m[3]
      const alt = parsePriceText(shortened)
      if (alt !== null && alt <= 50000 && alt > 0) return alt
    }
  }
  return direct
}

// ── Price-column detection ──

interface PriceColumn {
  min: number
  max: number
}

/**
 * Find the receipt's price column by clustering the right edges of all
 * price-shaped tokens and taking the rightmost cluster.
 */
function detectPriceColumn(lines: OcrLine[]): PriceColumn | null {
  const xs: number[] = []
  for (const line of lines) {
    const fused = fuseNumberWords(line.words)
    for (const w of fused) {
      if (PRICE_TOKEN_RE.test(w.text)) xs.push(w.bbox.x1)
    }
  }
  if (xs.length === 0) return null
  xs.sort((a, b) => a - b)
  const maxX = xs[xs.length - 1]
  const tol = Math.max(30, maxX * 0.1)
  let min = maxX
  for (let i = xs.length - 1; i >= 0; i--) {
    if (maxX - xs[i] <= tol) min = xs[i]
    else break
  }
  return { min: min - tol, max: maxX + 5 }
}

// ── Per-line extraction ──

interface PriceInfo {
  token: OcrWord
  cents: number
  index: number
  inCol: boolean
  fromQtyUnit?: boolean
}

/** Rightmost price-shaped token on a line. Prefers price-column matches. */
function findLinePrice(
  fusedWords: OcrWord[],
  priceCol: PriceColumn | null,
): PriceInfo | null {
  let best: PriceInfo | null = null
  for (let i = 0; i < fusedWords.length; i++) {
    const w = fusedWords[i]
    if (!PRICE_TOKEN_RE.test(w.text)) continue
    const cents = parsePriceTextWithFallback(w.text)
    if (cents == null) continue
    // Reject out-of-range tokens that weren't rescued by the fallback.
    if (cents > 50000) continue
    const inCol = !priceCol || w.bbox.x1 >= priceCol.min
    if (
      !best ||
      (inCol && !best.inCol) ||
      (inCol === best.inCol && w.bbox.x0 > best.token.bbox.x0)
    ) {
      best = { token: w, cents, index: i, inCol }
    }
  }
  return best
}

interface QtyUnit {
  cents: number
  unit: number
  qty: number
}

/**
 * Extract a "UNIT × QTY" pattern from line text. Used both as a
 * fallback price and as a cross-check against the rightmost price.
 */
function priceFromQtyUnit(text: string): QtyUnit | null {
  const m = text.match(/(\d{1,3}(?:,\d{3})*\.\d{2})\s*[xX×]\s*(\d{1,3})\b/)
  if (!m) return null
  const unit = parseFloat(m[1].replace(/,/g, ''))
  const qty = parseInt(m[2], 10)
  if (isNaN(unit) || isNaN(qty) || qty < 1 || qty > 99) return null
  return { cents: Math.round(unit * qty * 100), unit, qty }
}

// ── Name cleanup ──

function cleanName(raw: string): string {
  let n = raw
  let prev = ''
  for (let i = 0; i < 4 && n !== prev; i++) {
    prev = n
    // Leading OCR garbage (keep quotes / "+" / "[" / "(" as legitimate
    // starts).
    n = n.replace(/^[^a-zA-Z0-9"'!+[(]+/, '')
    // Leading single letter + non-word punctuation (e.g. "e——").
    n = n.replace(/^[a-zA-Z][^a-zA-Z0-9\s]+\s*/, '')
    // Leading quantity prefix: "1 ", "1x ", "x2 ", etc.
    n = n.replace(/^\d+\s*[xX×]\s+/, '')
    n = n.replace(/^\d+\s+/, '')
    n = n.replace(/^[xX]\s*\d+\s+/, '')
    // Leading 1–2 char noise word before a capital/quote/digit.
    n = n.replace(/^[a-zA-Z]{1,2}\s+(?=[A-Z"'0-9])/, '')
  }
  n = n.replace(/[^a-zA-Z0-9"')!\]]+$/, '')
  n = n.replace(/[\s.\-_:]+$/, '')
  n = n.replace(/\s+[xX]\s*$/, '')
  n = n.replace(/\s+[A-Za-z]{1,2}$/, '')
  n = n.replace(/\s+\d$/, '')
  return n.trim()
}

function realWordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[a-zA-Z]{3,}/.test(w)).length
}

function hasAlpha(s: string): boolean {
  return /[a-zA-Z]/.test(s)
}

// ── Rescue pass overlay ──

/**
 * Look up the rightmost price-column token on the rescue pass for the
 * given y-midpoint. Returns cents or null if no suitable token exists.
 */
function rescuePriceAt(
  lineYMid: number,
  rescueLines: OcrLine[],
  priceCol: PriceColumn | null,
): number | null {
  if (rescueLines.length === 0) return null
  let best: { word: OcrWord; cents: number } | null = null
  for (const rLine of rescueLines) {
    const yMid = (rLine.bbox.y0 + rLine.bbox.y1) / 2
    const h = rLine.bbox.y1 - rLine.bbox.y0
    if (Math.abs(yMid - lineYMid) > h) continue
    const fused = fuseNumberWords(rLine.words)
    for (const w of fused) {
      if (!PRICE_TOKEN_RE.test(w.text)) continue
      const cents = parsePriceText(w.text)
      if (cents == null) continue
      const inCol = !priceCol || w.bbox.x1 >= priceCol.min
      if (!inCol) continue
      if (!best || w.bbox.x0 > best.word.bbox.x0) {
        best = { word: w, cents }
      }
    }
  }
  return best?.cents ?? null
}

// ── Entry point ──

/**
 * Parse the cached output of one-or-two Tesseract passes into
 * `ParsedItem`s. `cached.rescue` is optional: when absent, only the
 * main pass is consulted.
 */
export function parseReceiptV2(cached: CachedOcr): ParsedItem[] {
  const mainLines = cached.main.lines
  const rescueLines = cached.rescue?.lines ?? []
  const priceCol = detectPriceColumn(mainLines)

  interface Row {
    line: OcrLine
    fused: OcrWord[]
    lineText: string
    priceInfo: PriceInfo | null
    qtyUnit: QtyUnit | null
    yMid: number
  }

  const rows: Row[] = mainLines.map((line) => {
    const fused = fuseNumberWords(line.words)
    const lineText = line.text.replace(/\n/g, ' ').trim()
    return {
      line,
      fused,
      lineText,
      priceInfo: findLinePrice(fused, priceCol),
      qtyUnit: priceFromQtyUnit(lineText),
      yMid: (line.bbox.y0 + line.bbox.y1) / 2,
    }
  })

  const results: ParsedItem[] = []
  let orphanText = ''

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx]

    // Synthesize a priceInfo from qty×unit when the rightmost token
    // looks like a digit-only "price" (Tesseract dropped the decimal),
    // e.g. "Cheesy Bread 7.28x1 $7287" → use 7.28 × 1 = $7.28.
    if (!r.priceInfo && r.qtyUnit && r.fused.length > 0) {
      const rightWord = r.fused[r.fused.length - 1]
      if (/^[$£]?\d{3,5}[A-Za-z]?$/.test(rightWord.text)) {
        r.priceInfo = {
          token: rightWord,
          cents: r.qtyUnit.cents,
          index: r.fused.length - 1,
          inCol: !priceCol || rightWord.bbox.x1 >= priceCol.min,
          fromQtyUnit: true,
        }
      }
    }

    if (!r.priceInfo) {
      // No price on this row → candidate for multi-line item-name
      // merge. Accept as orphan only if it has ≥2 "real" words (≥3
      // letters each) and no skip-pattern hit.
      if (!r.lineText) continue
      if (SKIP_PATTERNS.some((p) => p.test(r.lineText))) {
        orphanText = ''
        continue
      }
      const cleaned = cleanName(r.lineText)
      if (realWordCount(cleaned) >= 2 && hasAlpha(cleaned)) {
        orphanText = cleaned
      }
      // Single-word noise doesn't overwrite an existing orphan and
      // doesn't produce one — it's tolerated in case a real orphan is
      // separated from its price line by a stray noise row.
      continue
    }

    let priceCents = r.priceInfo.cents

    // Name candidate = all fused words left of the price token.
    const rawNameWords = r.fused.slice(0, r.priceInfo.index)
    const rawName = rawNameWords.map((w) => w.text).join(' ')

    if (SKIP_PATTERNS.some((p) => p.test(rawName))) {
      orphanText = ''
      continue
    }

    // If the rightmost price candidate is actually a unit price in the
    // middle of the line (and not in the price column), prefer the
    // qty×unit-computed total.
    if (r.qtyUnit) {
      if (
        priceCol &&
        r.priceInfo.token.bbox.x1 < priceCol.min &&
        Math.abs(priceCents - Math.round(r.qtyUnit.unit * 100)) <= 1
      ) {
        priceCents = r.qtyUnit.cents
      }
    }

    // Conservative rescue-pass overlay: only adopt the rescue value
    // when it agrees with qty×unit. This keeps us from flipping a good
    // main-pass price on the basis of a noisy rescue token.
    const rescued = rescuePriceAt(r.yMid, rescueLines, priceCol)
    if (
      rescued != null &&
      rescued !== priceCents &&
      r.qtyUnit &&
      Math.abs(rescued - r.qtyUnit.cents) <= 1
    ) {
      priceCents = rescued
    }

    // Sanity bounds.
    if (priceCents < 0) {
      orphanText = ''
      continue
    }
    if (priceCents > 50000) {
      orphanText = ''
      continue
    }

    // Build final item name.
    let name = cleanName(rawName)
    if (!hasAlpha(rawName)) {
      if (orphanText) {
        name = orphanText
        orphanText = ''
      } else {
        continue
      }
    } else if (orphanText) {
      if (realWordCount(name) <= 1) {
        name = name ? orphanText + ' ' + name : orphanText
      }
      orphanText = ''
    }

    if (!name) continue
    if (name.replace(/[^a-zA-Z]/g, '').length < 3) continue

    // Exclude $0.00 items ONLY when the name is suspiciously short —
    // otherwise $0.00 modifiers (IMG_6490-style) are legitimate.
    results.push({ name, price: priceCents, included: true })
  }

  return results
}
