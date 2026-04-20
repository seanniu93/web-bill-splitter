export interface BillItem {
  id: string
  name: string
  /** Price in cents to avoid floating-point issues */
  price: number
  /** Names of people assigned to this item */
  assignedTo: string[]
}

export interface Person {
  name: string
  /** How many physical people this entity represents (default 1) */
  partySize: number
}

export type TipMode = 'amount' | 'percentage'
export type TaxTipSplit = 'proportional' | 'even'
export type Step = 'entry' | 'assign' | 'summary'

export interface BillState {
  items: BillItem[]
  people: Person[]
  taxAmount: number
  tipAmount: number
  tipMode: TipMode
  taxTipSplit: TaxTipSplit
  currentStep: Step
}
