import { useEffect, useRef, useState } from 'react'
import { toBlob } from 'html-to-image'
import type { BillItem, Person, TipMode, TaxTipSplit } from '../../types'
import { formatCents, parseDollarsToCents } from '../../utils/format'
import { calculateSplit, getBillSubtotal } from '../../utils/calculations'
import styles from './Summary.module.css'

interface Props {
  items: BillItem[]
  people: Person[]
  taxAmount: number
  tipAmount: number
  tipMode: TipMode
  taxTipSplit: TaxTipSplit
  onSetTaxAmount: (cents: number) => void
  onSetTipAmount: (value: number) => void
  onSetTipMode: (mode: TipMode) => void
  onSetTaxTipSplit: (mode: TaxTipSplit) => void
}

/** Convert cents to a display string, or empty if zero */
function centsToStr(cents: number): string {
  return cents ? (cents / 100).toFixed(2) : ''
}

export function Summary({
  items,
  people,
  taxAmount,
  tipAmount,
  tipMode,
  taxTipSplit,
  onSetTaxAmount,
  onSetTipAmount,
  onSetTipMode,
  onSetTaxTipSplit,
}: Props) {
  const exportRef = useRef<HTMLDivElement>(null)
  const subtotal = getBillSubtotal(items)

  // ── Local string state for inputs (synced to parent on blur) ──

  const [taxStr, setTaxStr] = useState(() => centsToStr(taxAmount))
  const [tipStr, setTipStr] = useState(() =>
    tipMode === 'percentage'
      ? tipAmount ? String(tipAmount) : ''
      : centsToStr(tipAmount),
  )

  // Sync local tax string if the parent value changes externally (e.g. restore from localStorage)
  useEffect(() => {
    setTaxStr(centsToStr(taxAmount))
  }, [taxAmount])

  const handleTaxBlur = () => {
    const cents = parseDollarsToCents(taxStr)
    onSetTaxAmount(cents)
    setTaxStr(centsToStr(cents))
  }

  const handleTipBlur = () => {
    if (tipMode === 'percentage') {
      const pct = parseFloat(tipStr) || 0
      onSetTipAmount(pct)
      setTipStr(pct ? String(pct) : '')
    } else {
      const cents = parseDollarsToCents(tipStr)
      onSetTipAmount(cents)
      setTipStr(centsToStr(cents))
    }
  }

  // Resolve tip to cents
  const tipCents =
    tipMode === 'percentage'
      ? Math.round((subtotal * tipAmount) / 100)
      : tipAmount

  const breakdowns = calculateSplit(
    items,
    people,
    taxAmount,
    tipCents,
    taxTipSplit,
  )

  const grandTotal = subtotal + taxAmount + tipCents
  const sumOfShares = breakdowns.reduce((sum, bd) => sum + bd.total, 0)

  // ── Collapsible person cards (all collapsed by default) ──

  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const togglePerson = (name: string) => {
    setExpandedPeople((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const allExpanded =
    breakdowns.length > 0 &&
    breakdowns.every((bd) => expandedPeople.has(bd.name))

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedPeople(new Set())
    } else {
      setExpandedPeople(new Set(breakdowns.map((bd) => bd.name)))
    }
  }

  const handleSaveImage = async () => {
    if (!exportRef.current || breakdowns.length === 0) return

    setIsExporting(true)
    setExportError('')

    try {
      const blob = await toBlob(exportRef.current, {
        cacheBust: true,
        pixelRatio: Math.max(2, Math.min(window.devicePixelRatio || 1, 3)),
        backgroundColor: getComputedStyle(exportRef.current).backgroundColor,
      })

      if (!blob) {
        throw new Error('Could not create image')
      }

      const fileName = `bill-summary-${new Date().toISOString().slice(0, 10)}.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      const shareData = {
        files: [file],
        title: 'Bill summary',
      } as ShareData

      const sharingNavigator = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean
        share?: (data: ShareData) => Promise<void>
      }

      if (sharingNavigator.canShare?.(shareData) && sharingNavigator.share) {
        await sharingNavigator.share(shareData)
        return
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      setExportError('Could not save the image.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className={styles.container}>
      {/* Tax & tip config */}
      <div className={styles.config}>
        <div className={styles.field}>
          <label className={styles.label}>Tax</label>
          <div className={styles.inputWrap}>
            <span className={styles.prefix}>$</span>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={taxStr}
              onChange={(e) => setTaxStr(e.target.value)}
              onBlur={handleTaxBlur}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Tip</label>
          <div className={styles.tipRow}>
            <div className={styles.inputWrap}>
              <span className={styles.prefix}>
                {tipMode === 'percentage' ? '%' : '$'}
              </span>
              <input
                className={styles.input}
                type="number"
                inputMode="decimal"
                step={tipMode === 'percentage' ? '1' : '0.01'}
                min="0"
                placeholder={tipMode === 'percentage' ? '0' : '0.00'}
                value={tipStr}
                onChange={(e) => setTipStr(e.target.value)}
                onBlur={handleTipBlur}
              />
            </div>
            <div className={styles.toggle}>
              <button
                className={`${styles.toggleBtn} ${tipMode === 'percentage' ? styles.toggleActive : ''}`}
                onClick={() => {
                  setTipStr('')
                  onSetTipAmount(0)
                  onSetTipMode('percentage')
                }}
              >
                %
              </button>
              <button
                className={`${styles.toggleBtn} ${tipMode === 'amount' ? styles.toggleActive : ''}`}
                onClick={() => {
                  setTipStr('')
                  onSetTipAmount(0)
                  onSetTipMode('amount')
                }}
              >
                $
              </button>
            </div>
          </div>
          {tipMode === 'percentage' && tipAmount > 0 && (
            <p className={styles.tipResolved}>
              = {formatCents(tipCents)}
            </p>
          )}
        </div>

        <div className={styles.fieldCenter}>
          <label className={styles.label}>Split tax & tip</label>
          <div className={styles.toggle}>
            <button
              className={`${styles.toggleBtn} ${styles.toggleWide} ${taxTipSplit === 'proportional' ? styles.toggleActive : ''}`}
              onClick={() => onSetTaxTipSplit('proportional')}
            >
              Proportional
            </button>
            <button
              className={`${styles.toggleBtn} ${styles.toggleWide} ${taxTipSplit === 'even' ? styles.toggleActive : ''}`}
              onClick={() => onSetTaxTipSplit('even')}
            >
              Even
            </button>
          </div>
        </div>
      </div>

      {/* Bill totals */}
      <div className={styles.billTotals}>
        <div className={styles.totalRow}>
          <span>Subtotal</span>
          <span>{formatCents(subtotal)}</span>
        </div>
        <div className={styles.totalRow}>
          <span>Tax</span>
          <span>{formatCents(taxAmount)}</span>
        </div>
        <div className={styles.totalRow}>
          <span>Tip</span>
          <span>{formatCents(tipCents)}</span>
        </div>
        <div className={`${styles.totalRow} ${styles.grandTotal}`}>
          <span>Total</span>
          <span>{formatCents(grandTotal)}</span>
        </div>
      </div>

      {/* Per-person breakdowns */}
      {breakdowns.length === 0 ? (
        <div className={styles.empty}>
          <p>No items assigned yet.</p>
          <p className={styles.emptyHint}>
            Go back to the Assign tab to assign items to people.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.breakdownsHeader}>
            <span className={styles.breakdownsTitle}>Per person</span>
            <button className={styles.expandAllBtn} onClick={toggleAll}>
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          </div>

          <div className={styles.breakdowns}>
            {breakdowns.map((bd) => {
              const isExpanded = expandedPeople.has(bd.name)
              return (
                <div key={bd.name} className={styles.personCard}>
                  <button
                    className={styles.personHeader}
                    onClick={() => togglePerson(bd.name)}
                  >
                    <span className={styles.personName}>
                      {bd.name}
                      {bd.partySize > 1 && (
                        <span className={styles.partySizeNote}>
                          {' '}
                          ({bd.partySize} people)
                        </span>
                      )}
                    </span>
                    <span className={styles.personHeaderRight}>
                      <span className={styles.personTotal}>
                        {formatCents(bd.total)}
                      </span>
                      <span
                        className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}
                      />
                    </span>
                  </button>

                  {isExpanded && (
                    <>
                      <div className={styles.personItems}>
                        {bd.items.map((it, i) => (
                          <div key={i} className={styles.personItemRow}>
                            <span className={styles.personItemName}>
                              {it.name}
                            </span>
                            <span className={styles.personItemAmount}>
                              {formatCents(it.amount)}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className={styles.personBreakdown}>
                        <div className={styles.breakdownRow}>
                          <span>Subtotal</span>
                          <span>{formatCents(bd.subtotal)}</span>
                        </div>
                        {bd.taxShare > 0 && (
                          <div className={styles.breakdownRow}>
                            <span>Tax</span>
                            <span>{formatCents(bd.taxShare)}</span>
                          </div>
                        )}
                        {bd.tipShare > 0 && (
                          <div className={styles.breakdownRow}>
                            <span>Tip</span>
                            <span>{formatCents(bd.tipShare)}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Verification */}
      {breakdowns.length > 0 && (
        <div className={styles.verification}>
          <span>Sum of all shares</span>
          <span>
            {formatCents(sumOfShares)}
          </span>
        </div>
      )}

      {breakdowns.length > 0 && (
        <div className={styles.exportActions}>
          <button
            className={styles.exportBtn}
            onClick={handleSaveImage}
            disabled={isExporting}
          >
            {isExporting ? 'Preparing image...' : 'Export as image'}
          </button>
          {exportError && (
            <p className={styles.exportError}>{exportError}</p>
          )}
        </div>
      )}

      {breakdowns.length > 0 && (
        <div className={styles.exportCanvas} aria-hidden="true">
          <div ref={exportRef} className={styles.exportCard}>
            <div className={styles.exportCardHeader}>
              <div>
                <p className={styles.exportEyebrow}>Bill Splitter</p>
                <h2 className={styles.exportTitle}>Bill Summary</h2>
              </div>
              <div className={styles.exportGrandTotal}>
                <span className={styles.exportGrandLabel}>Total</span>
                <span className={styles.exportGrandValue}>
                  {formatCents(grandTotal)}
                </span>
              </div>
            </div>

            <div className={styles.exportTotals}>
              <div className={styles.exportTotalRow}>
                <span>Subtotal</span>
                <span>{formatCents(subtotal)}</span>
              </div>
              <div className={styles.exportTotalRow}>
                <span>Tax</span>
                <span>{formatCents(taxAmount)}</span>
              </div>
              <div className={styles.exportTotalRow}>
                <span>Tip</span>
                <span>{formatCents(tipCents)}</span>
              </div>
              <div className={styles.exportTotalRow}>
                <span>People</span>
                <span>{breakdowns.length}</span>
              </div>
            </div>

            <div className={styles.exportPeopleHeader}>
              <span>Per person</span>
              <span>Amount</span>
            </div>

            <div className={styles.exportPeopleList}>
              {breakdowns.map((bd) => (
                <div key={bd.name} className={styles.exportPersonRow}>
                  <div className={styles.exportPersonMeta}>
                    <span className={styles.exportPersonName}>{bd.name}</span>
                    {bd.partySize > 1 && (
                      <span className={styles.exportPartySize}>
                        {bd.partySize} people
                      </span>
                    )}
                  </div>
                  <span className={styles.exportPersonAmount}>
                    {formatCents(bd.total)}
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.exportFooter}>
              <span>Sum of all shares</span>
              <span>{formatCents(sumOfShares)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
