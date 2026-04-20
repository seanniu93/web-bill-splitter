import type { BillItem, Person, TaxTipSplit } from '../types'

export interface PersonBreakdown {
  name: string
  partySize: number
  /** Individual item shares: item name, person's share in cents */
  items: { name: string; amount: number }[]
  subtotal: number
  taxShare: number
  tipShare: number
  total: number
}

/**
 * Calculate what each person owes.
 *
 * Item splitting: when an item is shared by multiple people, cost is
 * distributed proportionally by party size. E.g. if Alice (partySize=2) and
 * Bob (partySize=1) share a $30 item, Alice pays $20 and Bob pays $10.
 *
 * Tax/tip splitting:
 *  - "proportional": based on each person's subtotal relative to bill subtotal
 *  - "even": based on each person's partySize relative to total party size
 */
export function calculateSplit(
  items: BillItem[],
  people: Person[],
  taxCents: number,
  tipCents: number,
  taxTipSplit: TaxTipSplit,
): PersonBreakdown[] {
  const personMap = new Map<string, Person>()
  for (const p of people) {
    personMap.set(p.name, p)
  }

  // Accumulate per-person item shares
  const personItems = new Map<string, { name: string; amount: number }[]>()
  for (const p of people) {
    personItems.set(p.name, [])
  }

  for (const item of items) {
    if (item.assignedTo.length === 0) continue

    // Total party size across all assigned people for this item
    const totalPartySize = item.assignedTo.reduce((sum, name) => {
      const person = personMap.get(name)
      return sum + (person ? person.partySize : 1)
    }, 0)

    if (totalPartySize === 0) continue

    // Distribute item cost by party size, using largest-remainder method
    // to ensure cents add up exactly
    const shares = distributeByWeight(
      item.price,
      item.assignedTo.map((name) => {
        const person = personMap.get(name)
        return person ? person.partySize : 1
      }),
    )

    item.assignedTo.forEach((name, i) => {
      const list = personItems.get(name)
      if (list) {
        list.push({ name: item.name, amount: shares[i] })
      }
    })
  }

  // Calculate subtotals
  const subtotals = new Map<string, number>()
  let billSubtotal = 0
  for (const p of people) {
    const items = personItems.get(p.name) ?? []
    const sub = items.reduce((sum, it) => sum + it.amount, 0)
    subtotals.set(p.name, sub)
    billSubtotal += sub
  }

  // Distribute tax and tip
  let taxShares: number[]
  let tipShares: number[]

  if (taxTipSplit === 'proportional') {
    const weights = people.map((p) => subtotals.get(p.name) ?? 0)
    taxShares = distributeByWeight(taxCents, weights)
    tipShares = distributeByWeight(tipCents, weights)
  } else {
    // even: by party size
    const weights = people.map((p) => p.partySize)
    taxShares = distributeByWeight(taxCents, weights)
    tipShares = distributeByWeight(tipCents, weights)
  }

  return people.map((p, i) => {
    const items = personItems.get(p.name) ?? []
    const subtotal = subtotals.get(p.name) ?? 0
    const taxShare = taxShares[i]
    const tipShare = tipShares[i]
    return {
      name: p.name,
      partySize: p.partySize,
      items,
      subtotal,
      taxShare,
      tipShare,
      total: subtotal + taxShare + tipShare,
    }
  })
}

/**
 * Distribute `total` cents among buckets with given weights using the
 * largest-remainder method. Guarantees the shares sum to exactly `total`.
 */
export function distributeByWeight(
  total: number,
  weights: number[],
): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight === 0) return weights.map(() => 0)

  const exact = weights.map((w) => (total * w) / totalWeight)
  const floored = exact.map(Math.floor)
  let remainder = total - floored.reduce((a, b) => a + b, 0)

  // Give the extra cents to the entries with the largest fractional parts
  const fractionals = exact
    .map((e, i) => ({ index: i, frac: e - floored[i] }))
    .sort((a, b) => b.frac - a.frac)

  for (const { index } of fractionals) {
    if (remainder <= 0) break
    floored[index]++
    remainder--
  }

  return floored
}

/** Get the bill subtotal (sum of all item prices, regardless of assignment) */
export function getBillSubtotal(items: BillItem[]): number {
  return items.reduce((sum, item) => sum + item.price, 0)
}
