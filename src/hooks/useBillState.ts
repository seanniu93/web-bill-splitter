import { useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'
import type { BillState, BillItem, Step, TipMode, TaxTipSplit } from '../types'
import { generateId } from '../utils/id'

const DEFAULT_STATE: BillState = {
  items: [],
  people: [],
  taxAmount: 0,
  tipAmount: 0,
  tipMode: 'percentage',
  taxTipSplit: 'proportional',
  currentStep: 'entry',
}

export function useBillState() {
  const [state, setState] = useLocalStorage<BillState>(
    'bill-splitter-state',
    DEFAULT_STATE,
  )

  const setStep = useCallback(
    (step: Step) => setState((s) => ({ ...s, currentStep: step })),
    [setState],
  )

  // ── Item operations ──

  const addItem = useCallback(
    (name: string, price: number) => {
      const item: BillItem = {
        id: generateId(),
        name,
        price,
        assignedTo: [],
      }
      setState((s) => ({ ...s, items: [...s.items, item] }))
    },
    [setState],
  )

  const updateItem = useCallback(
    (id: string, name: string, price: number) => {
      setState((s) => ({
        ...s,
        items: s.items.map((it) =>
          it.id === id ? { ...it, name, price } : it,
        ),
      }))
    },
    [setState],
  )

  const removeItem = useCallback(
    (id: string) => {
      setState((s) => {
        const newItems = s.items.filter((it) => it.id !== id)
        // Clean up people who are no longer assigned to any item
        const assignedNames = new Set(newItems.flatMap((it) => it.assignedTo))
        const newPeople = s.people.filter((p) => assignedNames.has(p.name))
        return { ...s, items: newItems, people: newPeople }
      })
    },
    [setState],
  )

  // ── Assignment operations ──

  const toggleAssignment = useCallback(
    (itemId: string, personName: string) => {
      setState((s) => {
        const newItems = s.items.map((it) => {
          if (it.id !== itemId) return it
          const idx = it.assignedTo.indexOf(personName)
          const newAssigned =
            idx >= 0
              ? it.assignedTo.filter((n) => n !== personName)
              : [...it.assignedTo, personName]
          return { ...it, assignedTo: newAssigned }
        })

        // Ensure person exists in people list
        let newPeople = s.people
        if (!s.people.some((p) => p.name === personName)) {
          newPeople = [...s.people, { name: personName, partySize: 1 }]
        }

        // Clean up people who are no longer assigned to any item
        const assignedNames = new Set(newItems.flatMap((it) => it.assignedTo))
        newPeople = newPeople.filter((p) => assignedNames.has(p.name))

        return { ...s, items: newItems, people: newPeople }
      })
    },
    [setState],
  )

  const setPartySize = useCallback(
    (personName: string, size: number) => {
      setState((s) => ({
        ...s,
        people: s.people.map((p) =>
          p.name === personName ? { ...p, partySize: Math.max(1, size) } : p,
        ),
      }))
    },
    [setState],
  )

  // ── Tax/Tip ──

  const setTaxAmount = useCallback(
    (cents: number) => setState((s) => ({ ...s, taxAmount: cents })),
    [setState],
  )

  const setTipAmount = useCallback(
    (value: number) => setState((s) => ({ ...s, tipAmount: value })),
    [setState],
  )

  const setTipMode = useCallback(
    (mode: TipMode) => setState((s) => ({ ...s, tipMode: mode })),
    [setState],
  )

  const setTaxTipSplit = useCallback(
    (mode: TaxTipSplit) => setState((s) => ({ ...s, taxTipSplit: mode })),
    [setState],
  )

  // ── Reset ──

  const resetBill = useCallback(
    () => setState(DEFAULT_STATE),
    [setState],
  )

  return {
    state,
    setStep,
    addItem,
    updateItem,
    removeItem,
    toggleAssignment,
    setPartySize,
    setTaxAmount,
    setTipAmount,
    setTipMode,
    setTaxTipSplit,
    resetBill,
  }
}
