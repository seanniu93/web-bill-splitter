import { useState } from 'react'
import type { ParsedItem } from '../../utils/parseReceipt'
import type { TipMode } from '../../types'
import {
  LLM_PROMPT,
  parseLlmResponse,
} from '../../utils/parseLlmResponse'
import { formatCents } from '../../utils/format'
import styles from './LlmImport.module.css'

interface Props {
  onAddItems: (items: { name: string; price: number }[]) => void
  onSetTaxAmount: (cents: number) => void
  onSetTipAmount: (value: number) => void
  onSetTipMode: (mode: TipMode) => void
}

type LlmState =
  | { phase: 'idle' }
  | { phase: 'compose'; pasted: string; error: string | null }
  | {
      phase: 'review'
      items: ParsedItem[]
      taxCents: number | null
      tipCents: number | null
      applyTax: boolean
      applyTip: boolean
    }

const CHATGPT_URL = 'https://chatgpt.com/'
const GEMINI_URL = 'https://gemini.google.com/app'

export function LlmImport({
  onAddItems,
  onSetTaxAmount,
  onSetTipAmount,
  onSetTipMode,
}: Props) {
  const [state, setState] = useState<LlmState>({ phase: 'idle' })
  const [copied, setCopied] = useState(false)

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(LLM_PROMPT)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (e.g. insecure context); user can
      // select-and-copy from the textarea as a fallback.
    }
  }

  const openIn = async (url: string) => {
    // Also copy so the user can paste immediately in the new tab.
    try {
      await navigator.clipboard.writeText(LLM_PROMPT)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Non-fatal; the textarea is still available.
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleStart = () => {
    setState({ phase: 'compose', pasted: '', error: null })
  }

  const handleCancel = () => {
    setState({ phase: 'idle' })
  }

  const handlePasteChange = (value: string) => {
    if (state.phase !== 'compose') return
    setState({ ...state, pasted: value, error: null })
  }

  const handleParse = () => {
    if (state.phase !== 'compose') return
    try {
      const result = parseLlmResponse(state.pasted)
      setState({
        phase: 'review',
        items: result.items,
        taxCents: result.taxCents,
        tipCents: result.tipCents,
        applyTax: result.taxCents !== null,
        applyTip: result.tipCents !== null,
      })
    } catch (err) {
      setState({
        ...state,
        error: err instanceof Error ? err.message : 'Parse failed.',
      })
    }
  }

  const toggleItem = (index: number) => {
    if (state.phase !== 'review') return
    setState({
      ...state,
      items: state.items.map((item, i) =>
        i === index ? { ...item, included: !item.included } : item,
      ),
    })
  }

  const updateItemName = (index: number, name: string) => {
    if (state.phase !== 'review') return
    setState({
      ...state,
      items: state.items.map((item, i) =>
        i === index ? { ...item, name } : item,
      ),
    })
  }

  const updateItemPrice = (index: number, priceStr: string) => {
    if (state.phase !== 'review') return
    const dollars = parseFloat(priceStr)
    const cents = isNaN(dollars) ? 0 : Math.round(dollars * 100)
    setState({
      ...state,
      items: state.items.map((item, i) =>
        i === index ? { ...item, price: cents } : item,
      ),
    })
  }

  const toggleApplyTax = () => {
    if (state.phase !== 'review') return
    setState({ ...state, applyTax: !state.applyTax })
  }

  const toggleApplyTip = () => {
    if (state.phase !== 'review') return
    setState({ ...state, applyTip: !state.applyTip })
  }

  const handleConfirm = () => {
    if (state.phase !== 'review') return
    const toAdd = state.items
      .filter((it) => it.included && it.name.trim() && it.price > 0)
      .map((it) => ({ name: it.name.trim(), price: it.price }))
    if (toAdd.length > 0) onAddItems(toAdd)
    if (state.applyTax && state.taxCents !== null) {
      onSetTaxAmount(state.taxCents)
    }
    if (state.applyTip && state.tipCents !== null) {
      // LLM returns tip as an absolute dollar amount, so ensure the
      // tip mode is 'amount' rather than the default 'percentage'.
      onSetTipMode('amount')
      onSetTipAmount(state.tipCents)
    }
    setState({ phase: 'idle' })
  }

  const includedCount =
    state.phase === 'review'
      ? state.items.filter(
          (it) => it.included && it.name.trim() && it.price > 0,
        ).length
      : 0

  const expanded = state.phase !== 'idle'

  return (
    <div
      className={styles.container}
      data-expanded={expanded ? 'true' : undefined}
    >
      {state.phase === 'idle' && (
        <button className={styles.triggerBtn} onClick={handleStart}>
          <span className={styles.sparkleIcon} aria-hidden="true">
            &#x2728;
          </span>
          Import from LLM
        </button>
      )}

      {state.phase === 'compose' && (
        <div className={styles.panel}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.stepNum}>1</span>
              <span className={styles.sectionTitle}>
                Copy the prompt and attach your receipt image
              </span>
            </div>
            <textarea
              className={styles.promptArea}
              value={LLM_PROMPT}
              readOnly
              rows={6}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className={styles.promptActions}>
              <button className={styles.copyBtn} onClick={copyPrompt}>
                {copied ? 'Copied!' : 'Copy prompt'}
              </button>
              <div className={styles.openActions}>
                <button
                  className={styles.openBtn}
                  onClick={() => openIn(GEMINI_URL)}
                >
                  Open in Gemini
                </button>
                <button
                  className={styles.openBtn}
                  onClick={() => openIn(CHATGPT_URL)}
                >
                  Open in ChatGPT
                </button>
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.stepNum}>2</span>
              <span className={styles.sectionTitle}>
                Paste the LLM&rsquo;s JSON response here
              </span>
            </div>
            <textarea
              className={styles.pasteArea}
              value={state.pasted}
              onChange={(e) => handlePasteChange(e.target.value)}
              placeholder='{ "items": [...], "tax": ..., "tip": ... }'
              rows={6}
              spellCheck={false}
            />
            {state.error && (
              <p className={styles.errorText}>{state.error}</p>
            )}
          </div>

          <div className={styles.actions}>
            <button
              className={styles.primaryBtn}
              onClick={handleParse}
              disabled={!state.pasted.trim()}
            >
              Parse response
            </button>
            <button
              className={styles.cancelBtn}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.phase === 'review' && (
        <div className={styles.panel}>
          <p className={styles.reviewHint}>
            Review and edit imported items. Uncheck any you want to
            skip.
          </p>

          <ul className={styles.reviewList}>
            {state.items.map((item, i) => (
              <li
                key={i}
                className={`${styles.reviewRow} ${!item.included ? styles.reviewRowExcluded : ''}`}
              >
                <input
                  type="checkbox"
                  checked={item.included}
                  onChange={() => toggleItem(i)}
                  className={styles.checkbox}
                />
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => updateItemName(i, e.target.value)}
                  className={styles.reviewName}
                />
                <div className={styles.reviewPriceWrap}>
                  <span className={styles.reviewDollar}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={
                      item.price ? (item.price / 100).toFixed(2) : ''
                    }
                    onChange={(e) =>
                      updateItemPrice(i, e.target.value)
                    }
                    className={styles.reviewPrice}
                  />
                </div>
              </li>
            ))}
          </ul>

          {(state.taxCents !== null || state.tipCents !== null) && (
            <div className={styles.applyExtras}>
              {state.taxCents !== null && (
                <label className={styles.applyRow}>
                  <input
                    type="checkbox"
                    checked={state.applyTax}
                    onChange={toggleApplyTax}
                    className={styles.checkbox}
                  />
                  <span>
                    Apply tax{' '}
                    <span className={styles.applyAmount}>
                      {formatCents(state.taxCents)}
                    </span>
                  </span>
                </label>
              )}
              {state.tipCents !== null && (
                <label className={styles.applyRow}>
                  <input
                    type="checkbox"
                    checked={state.applyTip}
                    onChange={toggleApplyTip}
                    className={styles.checkbox}
                  />
                  <span>
                    Apply tip{' '}
                    <span className={styles.applyAmount}>
                      {formatCents(state.tipCents)}
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          <div className={styles.actions}>
            <button
              className={styles.primaryBtn}
              onClick={handleConfirm}
              disabled={includedCount === 0}
            >
              {includedCount > 0
                ? `Add ${includedCount} item${includedCount > 1 ? 's' : ''}`
                : 'Add items'}
            </button>
            <button
              className={styles.cancelBtn}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
