export interface ParsedItem {
  name: string
  /** Price in cents */
  price: number
  /** Whether this item should be included (default true, user can uncheck) */
  included: boolean
}

/**
 * Words that indicate a line is a total/tax/non-item line and should be
 * excluded from parsed results. Applied to the text BEFORE the price.
 */
const SKIP_PATTERNS = [
  /\bsubtotal?\b/i,
  /\bsub\s*total\b/i,
  /\btotal\b/i,
  /\btax\b/i,
  /\btip\b/i,
  /\bgratuity\b/i,
  /\bchange\b/i,
  /\bbalance\b/i,
  /\bvisa\b/i,
  /\bmastercard\b/i,
  /\bamex\b/i,
  /\bdisc(?:ount)?\b/i,
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
  /\binput\s*type\b/i,
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
]

/**
 * Regex to find a price anywhere in a line.
 *
 * Matches: $18.50, $5.00, 18.50, 22,50 (comma decimal), $1,234.50
 * The $ sign is optional to handle receipts that don't print it
 * (e.g. Chick-fil-A) and OCR that misreads $ as other symbols.
 *
 * NOT anchored to end-of-line, because OCR often produces trailing noise
 * from background textures in photos.
 *
 * We use a global regex and take the LAST match on each line (rightmost
 * price), since item prices appear on the right side of receipts.
 */
const PRICE_RE = /[$£]?\s*(\d{1,3}(?:,\d{3})*[.,]\d{1,2})\b/g

/**
 * Clean up an item name extracted from OCR text.
 * Runs multiple passes to handle cases where one cleanup exposes another
 * (e.g. removing noise prefix "er " reveals qty prefix "1 ").
 */
function cleanName(raw: string): string {
  let name = raw
  let prev = ''

  // Loop until stable (max 4 passes to avoid infinite loops)
  for (let i = 0; i < 4 && name !== prev; i++) {
    prev = name

    // Remove leading non-alphanumeric OCR garbage (keep quotes, !, +, [)
    name = name.replace(/^[^a-zA-Z0-9"'"!+\[]+/, '')

    // Remove single letter followed by non-word garbage, e.g. "e——"
    name = name.replace(/^[a-zA-Z][^a-zA-Z0-9\s]+\s*/, '')

    // Remove leading quantity prefix: "1 ", "2 ", "1x ", "x1 ", etc.
    name = name.replace(/^\d+\s*[xX×]?\s+/, '')
    name = name.replace(/^[xX]\d+\s+/, '')

    // Remove short (1-2 char) leading noise words likely from OCR
    // background artifacts (e.g. "er", "Te") when followed by
    // an uppercase letter, quote, or digit. Only 1-2 char words are
    // stripped — 3-char words like "All", "The" are too often real.
    name = name.replace(/^[a-zA-Z]{1,2}\s+(?=[A-Z"'0-9])/, '')
  }

  // Remove trailing non-alphanumeric garbage first (e.g. em-dashes,
  // underscores from OCR) so the short-word cleanup can see the real end.
  name = name.replace(/[^a-zA-Z0-9"')!\]]+$/, '')

  // Remove trailing separators (dots, dashes, colons)
  name = name.replace(/[\s.\-_:]+$/, '')

  // Remove trailing short noise: 1-2 letter words, single digits,
  // or mixed noise like "&y", "<Q", "@m" from handwriting/background.
  name = name.replace(/\s+[A-Za-z]{1,2}$/, '')
  name = name.replace(/\s+\d$/, '')
  name = name.replace(/\s+[^a-zA-Z0-9\s]{1,2}[a-zA-Z]?$/, '')

  return name.trim()
}

/**
 * Count the number of "real" words (3+ letters) in a string.
 */
function realWordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[a-zA-Z]{3,}/.test(w)).length
}

/**
 * Check if a line looks like plausible orphan text (first part of a
 * multi-line item name). Must have at least two words of 3+ letters
 * and not match skip patterns. This is intentionally strict to avoid
 * accumulating OCR noise as orphan text.
 */
function isPlausibleOrphan(text: string): boolean {
  if (!text) return false
  if (SKIP_PATTERNS.some((pat) => pat.test(text))) return false
  if (realWordCount(text) < 2) return false

  // Reject lines that look like dates, times, or header info
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(text)) return false
  if (/^\d{1,2}:\d{2}/.test(text)) return false

  return true
}

/**
 * Determine whether a price match on a line is likely a real item price
 * rather than a date, time, address number, or other false positive.
 * This is especially important when the $ sign is optional.
 */
function isLikelyPrice(
  line: string,
  matchIndex: number,
  hasDollarSign: boolean,
): boolean {
  // If it has a $ sign, it's very likely a price
  if (hasDollarSign) return true

  // Without $, reject if the line looks like a date/time/address
  if (/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(line)) return false
  if (/\d{1,2}:\d{2}/.test(line)) return false

  // Reject if the number appears at the very start (likely an address)
  if (matchIndex < 3) return false

  // Reject common false positive patterns (phone numbers, zip codes, etc.)
  if (/\d{3}[.-]\d{3}[.-]\d{4}/.test(line)) return false
  if (/\b\d{5}\b/.test(line) && !/\.\d{2}/.test(line.slice(matchIndex))) return false

  return true
}

/**
 * Parse raw OCR text from a receipt into candidate item/price pairs.
 *
 * Strategy:
 * 1. Split into lines
 * 2. For each line, find ALL price patterns (not just at end of line,
 *    since OCR often appends noise from the photo background)
 * 3. Take the last (rightmost) price on the line
 * 4. Everything before that price is the candidate item name
 * 5. If a line has no price, remember it as an "orphan" — it may be
 *    the first half of a multi-line item name (e.g. "Chicken Parmesan
 *    and Basil Pesto" wrapping to "Linguine $29.00")
 * 6. Orphan text is only merged if the current name is very short
 *    (≤1 real word), matching the typical multi-line overflow pattern.
 *    This prevents false merges when OCR misses a price entirely.
 * 7. Skip lines matching non-item heuristics
 * 8. Return results for user review
 */
export function parseReceipt(text: string): ParsedItem[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const results: ParsedItem[] = []
  let orphanText = ''

  for (const line of lines) {
    // Find all price matches on this line, take the last one
    const matches = [...line.matchAll(PRICE_RE)]
    if (matches.length === 0) {
      // No price — check if this could be the start of a multi-line item
      const candidate = cleanName(line)
      if (isPlausibleOrphan(candidate)) {
        orphanText = candidate
      } else {
        // Don't clear orphanText for non-plausible lines — noise might
        // sit between a real orphan and its price line. But DO clear
        // if it matches a skip pattern.
        if (SKIP_PATTERNS.some((pat) => pat.test(line))) {
          orphanText = ''
        }
      }
      continue
    }

    const lastMatch = matches[matches.length - 1]
    const fullMatch = lastMatch[0]
    const hasDollarSign = /[$£]/.test(fullMatch)
    const matchIndex = lastMatch.index ?? 0

    // Validate the price match (especially important without $ sign)
    if (!isLikelyPrice(line, matchIndex, hasDollarSign)) {
      continue
    }

    let priceRaw = lastMatch[1].replace(/,/g, '.')
    // Normalize single-decimal prices (e.g. "16.5" from OCR misread of "16.50")
    if (/\.\d$/.test(priceRaw)) {
      priceRaw += '0'
    }
    const priceDollars = parseFloat(priceRaw)
    if (isNaN(priceDollars) || priceDollars < 0) {
      orphanText = ''
      continue
    }

    // Sanity check: reject unreasonably high prices (likely OCR false
    // positives, e.g. "914.90" from garbled "$14.95")
    if (priceDollars > 500) {
      continue
    }

    // Everything before the price match is the item name
    const nameEnd = matchIndex
    const rawName = line.slice(0, nameEnd)

    // Check skip patterns on the name portion (not the whole line with noise)
    if (SKIP_PATTERNS.some((pat) => pat.test(rawName))) {
      orphanText = ''
      continue
    }

    let name = cleanName(rawName)

    // Merge orphan text only if the current name is very short (≤1 real
    // word), suggesting it's a continuation of a multi-line item name.
    // If the current name is already substantial, the orphan was likely
    // a separate item whose price was missed by OCR — discard it.
    if (orphanText) {
      if (realWordCount(name) <= 1) {
        name = name ? orphanText + ' ' + name : orphanText
      }
      orphanText = ''
    }

    if (!name) {
      orphanText = ''
      continue
    }

    // Reject items with very short names (≤2 chars) — likely OCR
    // garbage from garbled skip-pattern lines like "Tax" → "Lo"
    if (name.replace(/[^a-zA-Z]/g, '').length < 3) {
      continue
    }

    const cents = Math.round(priceDollars * 100)
    results.push({ name, price: cents, included: true })
  }

  return results
}
