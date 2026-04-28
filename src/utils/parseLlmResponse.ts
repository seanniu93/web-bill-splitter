import type { ParsedItem } from './parseReceipt'

export interface LlmImportResult {
  items: ParsedItem[]
  /** Tax in cents, or null if the LLM did not report tax */
  taxCents: number | null
  /** Tip in cents, or null if the LLM did not report tip */
  tipCents: number | null
}

/**
 * The prompt we tell users to paste into their LLM of choice together
 * with the receipt image. Kept strict to maximise the chance of getting
 * back a clean, parseable JSON object.
 */
export const LLM_PROMPT = `You are a receipt-parsing assistant. I am uploading a receipt image along with this prompt.

Respond with ONLY a JSON object (no markdown fences, no prose) matching this exact schema:

{
  "items": [ { "name": "string", "price": number } ],
  "tax": number | null,
  "tip": number | null
}

Rules:
- Prices, tax, and tip are in dollars (e.g. 12.50 for $12.50).
- "items" must contain only ordered line items. Exclude subtotal, total, tax, tip, payment, and change lines.
- If a line shows a quantity greater than 1, keep a single row with the combined price exactly as printed (e.g. "2x Fries" at 8.00 stays as one row priced 8.00).
- Use null for "tax" or "tip" if they are not printed on the receipt.
- Do not wrap the JSON in code fences. Do not add any explanation.`

/**
 * Strip common wrappers LLMs add around JSON even when told not to.
 * Handles: ```json ... ```, ``` ... ```, leading/trailing prose.
 */
function extractJsonBlock(input: string): string {
  let text = input.trim()

  // Strip a single ``` or ```json fence pair if the whole thing is wrapped.
  const fenceMatch = text.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```\s*$/)
  if (fenceMatch) {
    text = fenceMatch[1].trim()
  }

  // If the text still doesn't start with "{", try to find the first balanced
  // top-level JSON object. Naive approach: take from first "{" to matching "}".
  if (!text.startsWith('{')) {
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1)
    }
  }

  return text
}

function toCentsOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const num =
    typeof value === 'number' ? value : parseFloat(String(value))
  if (!isFinite(num) || num < 0) return null
  return Math.round(num * 100)
}

/**
 * Parse an LLM's response string into a structured import result.
 * Throws with a human-readable message on any validation failure so the
 * UI can display it directly.
 */
export function parseLlmResponse(input: string): LlmImportResult {
  if (!input.trim()) {
    throw new Error('Paste the LLM response above before parsing.')
  }

  const jsonText = extractJsonBlock(input)

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error(
      'Could not parse JSON. Paste only the JSON object the model returned.',
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object with an "items" array.')
  }

  const obj = parsed as Record<string, unknown>
  const rawItems = obj.items
  if (!Array.isArray(rawItems)) {
    throw new Error('Missing "items" array in response.')
  }

  const items: ParsedItem[] = []
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const name =
      typeof entry.name === 'string' ? entry.name.trim() : ''
    const priceNum =
      typeof entry.price === 'number'
        ? entry.price
        : parseFloat(String(entry.price))
    if (!name || !isFinite(priceNum) || priceNum <= 0) continue
    items.push({
      name,
      price: Math.round(priceNum * 100),
      included: true,
    })
  }

  if (items.length === 0) {
    throw new Error('No valid items found in the response.')
  }

  return {
    items,
    taxCents: toCentsOrNull(obj.tax),
    tipCents: toCentsOrNull(obj.tip),
  }
}
