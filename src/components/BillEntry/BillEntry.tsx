import { useState, useRef } from 'react'
import type { BillItem, TipMode } from '../../types'
import { formatCents, parseDollarsToCents } from '../../utils/format'
import { getBillSubtotal } from '../../utils/calculations'
import { OcrScanner } from './OcrScanner'
import { LlmImport } from './LlmImport'
import styles from './BillEntry.module.css'

interface Props {
  items: BillItem[]
  onAddItem: (name: string, price: number) => void
  onAddItems: (items: { name: string; price: number }[]) => void
  onUpdateItem: (id: string, name: string, price: number) => void
  onRemoveItem: (id: string) => void
  onSetTaxAmount: (cents: number) => void
  onSetTipAmount: (value: number) => void
  onSetTipMode: (mode: TipMode) => void
  onNext: () => void
}

export function BillEntry({
  items,
  onAddItem,
  onAddItems,
  onUpdateItem,
  onRemoveItem,
  onSetTaxAmount,
  onSetTipAmount,
  onSetTipMode,
  onNext,
}: Props) {
  const [name, setName] = useState('')
  const [priceStr, setPriceStr] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  const handleAdd = () => {
    const trimmed = name.trim()
    const cents = parseDollarsToCents(priceStr)
    if (!trimmed || cents <= 0) return
    onAddItem(trimmed, cents)
    setName('')
    setPriceStr('')
    nameRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd()
  }

  const startEdit = (item: BillItem) => {
    setEditingId(item.id)
    setEditName(item.name)
    setEditPrice((item.price / 100).toFixed(2))
  }

  const commitEdit = () => {
    if (!editingId) return
    const trimmed = editName.trim()
    const cents = parseDollarsToCents(editPrice)
    if (trimmed && cents > 0) {
      onUpdateItem(editingId, trimmed, cents)
    }
    setEditingId(null)
  }

  const cancelEdit = () => setEditingId(null)

  const subtotal = getBillSubtotal(items)

  return (
    <div className={styles.container}>
      {/* Receipt import (OCR + LLM). Flows side-by-side when space
          allows, stacks otherwise. Whichever is active expands to
          full width via the :has() selector in the stylesheet. */}
      <div className={styles.importRow}>
        <OcrScanner onAddItems={onAddItems} />
        <LlmImport
          onAddItems={onAddItems}
          onSetTaxAmount={onSetTaxAmount}
          onSetTipAmount={onSetTipAmount}
          onSetTipMode={onSetTipMode}
        />
      </div>

      {/* Add item form */}
      <div className={styles.addForm}>
        <input
          ref={nameRef}
          className={styles.nameInput}
          type="text"
          placeholder="Item name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className={styles.priceInputWrap}>
          <span className={styles.dollarSign}>$</span>
          <input
            className={styles.priceInput}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <button
          className={styles.addBtn}
          onClick={handleAdd}
          disabled={!name.trim() || parseDollarsToCents(priceStr) <= 0}
        >
          Add
        </button>
      </div>

      {/* Item list */}
      {items.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>No items yet</p>
          <p className={styles.emptyHint}>
            Add items from your bill above
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((item) =>
            editingId === item.id ? (
              <li key={item.id} className={styles.editRow}>
                <input
                  className={styles.editNameInput}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') cancelEdit()
                  }}
                  autoFocus
                />
                <div className={styles.priceInputWrap}>
                  <span className={styles.dollarSign}>$</span>
                  <input
                    className={styles.editPriceInput}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') cancelEdit()
                    }}
                  />
                </div>
                <button className={styles.saveBtn} onClick={commitEdit}>
                  Save
                </button>
                <button className={styles.cancelBtn} onClick={cancelEdit}>
                  Cancel
                </button>
              </li>
            ) : (
              <li key={item.id} className={styles.row}>
                <button
                  className={styles.rowBody}
                  onClick={() => startEdit(item)}
                >
                  <span className={styles.itemName}>{item.name}</span>
                  <span className={styles.itemPrice}>
                    {formatCents(item.price)}
                  </span>
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => onRemoveItem(item.id)}
                  aria-label={`Delete ${item.name}`}
                >
                  &times;
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {/* Footer */}
      <div className={styles.footer}>
        {items.length > 0 && (
          <div className={styles.subtotal}>
            <span>Subtotal</span>
            <span className={styles.subtotalAmount}>
              {formatCents(subtotal)}
            </span>
          </div>
        )}
        <button
          className={styles.nextBtn}
          onClick={onNext}
          disabled={items.length === 0}
        >
          Next: Assign Items
        </button>
      </div>
    </div>
  )
}
