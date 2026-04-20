/** Format cents as a dollar string like "$12.50" */
export function formatCents(cents: number): string {
  const dollars = cents / 100
  return '$' + dollars.toFixed(2)
}

/** Parse a dollar string (e.g. "12.50" or "$12.50") into cents */
export function parseDollarsToCents(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '')
  const dollars = parseFloat(cleaned)
  if (isNaN(dollars)) return 0
  return Math.round(dollars * 100)
}
