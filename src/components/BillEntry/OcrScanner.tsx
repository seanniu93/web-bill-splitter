import { useState, useRef, useCallback, useEffect } from 'react'
import type { Worker } from 'tesseract.js'
import { parseReceipt, type ParsedItem } from '../../utils/parseReceipt'
import styles from './OcrScanner.module.css'

interface Props {
  onAddItems: (items: { name: string; price: number }[]) => void
}

type ScanState =
  | { phase: 'idle' }
  | { phase: 'loading'; status: string; progress: number }
  | { phase: 'review'; items: ParsedItem[]; rawText: string }
  | { phase: 'error'; message: string }

export function OcrScanner({ onAddItems }: Props) {
  const [state, setState] = useState<ScanState>({ phase: 'idle' })
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      // Show image preview
      const previewUrl = URL.createObjectURL(file)
      setImagePreview(previewUrl)

      setState({ phase: 'loading', status: 'Loading OCR engine...', progress: 0 })

      try {
        // Lazy-load tesseract.js and create worker on first use
        if (!workerRef.current) {
          const { createWorker } = await import('tesseract.js')
          workerRef.current = await createWorker('eng', 1, {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                setState({
                  phase: 'loading',
                  status: 'Recognizing text...',
                  progress: Math.round(m.progress * 100),
                })
              } else if (m.status === 'loading language traineddata') {
                setState({
                  phase: 'loading',
                  status: 'Downloading language data...',
                  progress: Math.round(m.progress * 100),
                })
              }
            },
          })
          // Blacklist currency/typography glyphs that never appear on US
          // restaurant receipts but are common Tesseract misreads of
          // digits (e.g. "6" → "£", "8" → "§"). Measured on our
          // training set: +1 item recovered, +1 price corrected, zero
          // regressions across all other receipts.
          await workerRef.current.setParameters({
            tessedit_char_blacklist: '£§¥¢',
          })
        }

        setState({ phase: 'loading', status: 'Recognizing text...', progress: 0 })

        const { data } = await workerRef.current.recognize(file)
        const parsed = parseReceipt(data.text)

        if (parsed.length === 0) {
          setState({
            phase: 'review',
            items: [],
            rawText: data.text,
          })
        } else {
          setState({
            phase: 'review',
            items: parsed,
            rawText: data.text,
          })
        }
      } catch (err) {
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'OCR failed',
        })
      }

      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [],
  )

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

  const handleAddItems = () => {
    if (state.phase !== 'review') return
    const toAdd = state.items
      .filter((it) => it.included && it.name.trim() && it.price > 0)
      .map((it) => ({ name: it.name.trim(), price: it.price }))
    if (toAdd.length > 0) {
      onAddItems(toAdd)
    }
    setState({ phase: 'idle' })
    setImagePreview(null)
  }

  const handleCancel = () => {
    setState({ phase: 'idle' })
    setImagePreview(null)
  }

  const includedCount =
    state.phase === 'review'
      ? state.items.filter((it) => it.included && it.name.trim() && it.price > 0).length
      : 0

  return (
    <div
      className={styles.container}
      data-expanded={state.phase !== 'idle' ? 'true' : undefined}
    >
      {/* Idle: show scan button */}
      {state.phase === 'idle' && (
        <label className={styles.scanBtn}>
          <span className={styles.scanIcon}>&#x1F4F7;</span>
          Scan receipt
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className={styles.fileInput}
            onChange={handleFileSelect}
          />
        </label>
      )}

      {/* Loading: progress bar */}
      {state.phase === 'loading' && (
        <div className={styles.loadingSection}>
          {imagePreview && (
            <img
              src={imagePreview}
              alt="Receipt preview"
              className={styles.preview}
            />
          )}
          <div className={styles.progressWrap}>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <p className={styles.progressLabel}>{state.status}</p>
          </div>
          <button className={styles.cancelBtn} onClick={handleCancel}>
            Cancel
          </button>
        </div>
      )}

      {/* Error */}
      {state.phase === 'error' && (
        <div className={styles.errorSection}>
          <p className={styles.errorText}>Scan failed: {state.message}</p>
          <div className={styles.errorActions}>
            <label className={styles.retryBtn}>
              Try again
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className={styles.fileInput}
                onChange={handleFileSelect}
              />
            </label>
            <button className={styles.cancelBtn} onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Review parsed items */}
      {state.phase === 'review' && (
        <div className={styles.reviewSection}>
          {imagePreview && (
            <img
              src={imagePreview}
              alt="Receipt preview"
              className={styles.preview}
            />
          )}

          {state.items.length === 0 ? (
            <div className={styles.noItems}>
              <p className={styles.noItemsText}>
                No items found in the receipt.
              </p>
              <details className={styles.rawTextDetails}>
                <summary>Show raw text</summary>
                <pre className={styles.rawText}>{state.rawText}</pre>
              </details>
            </div>
          ) : (
            <>
              <p className={styles.reviewHint}>
                Review and edit scanned items. Uncheck items to exclude them.
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
                        value={item.price ? (item.price / 100).toFixed(2) : ''}
                        onChange={(e) => updateItemPrice(i, e.target.value)}
                        className={styles.reviewPrice}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <details className={styles.rawTextDetails}>
                <summary>Show raw text</summary>
                <pre className={styles.rawText}>{state.rawText}</pre>
              </details>
            </>
          )}

          <div className={styles.reviewActions}>
            {includedCount > 0 && (
              <button className={styles.addItemsBtn} onClick={handleAddItems}>
                Add {includedCount} item{includedCount > 1 ? 's' : ''}
              </button>
            )}
            <label className={styles.rescanBtn}>
              Rescan
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className={styles.fileInput}
                onChange={handleFileSelect}
              />
            </label>
            <button className={styles.cancelBtn} onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
