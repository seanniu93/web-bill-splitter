import { useBillState } from './hooks/useBillState'
import { useTheme } from './hooks/useTheme'
import { Navigation } from './components/common/Navigation'
import { BillEntry } from './components/BillEntry/BillEntry'
import { Assignment } from './components/Assignment/Assignment'
import { Summary } from './components/Summary/Summary'
import styles from './App.module.css'

const THEME_ICON: Record<string, string> = {
  system: '\u25D1',  // ◑
  light: '\u2600',   // ☀
  dark: '\u263E',    // ☾
}

const THEME_LABEL: Record<string, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

export default function App() {
  const bill = useBillState()
  const { setting, cycleSetting } = useTheme()
  const { currentStep } = bill.state

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>Bill Splitter</h1>
        <div className={styles.headerActions}>
          <button
            className={styles.themeBtn}
            onClick={cycleSetting}
            aria-label={`Theme: ${THEME_LABEL[setting]}. Click to change.`}
            title={`Theme: ${THEME_LABEL[setting]}`}
          >
            {THEME_ICON[setting]}
          </button>
          <button
            className={styles.resetBtn}
            onClick={() => {
              if (
                bill.state.items.length === 0 ||
                window.confirm('Start a new bill? Current data will be lost.')
              ) {
                bill.resetBill()
              }
            }}
          >
            New Bill
          </button>
        </div>
      </header>

      <Navigation
        currentStep={currentStep}
        onStepChange={bill.setStep}
        itemCount={bill.state.items.length}
        unassignedCount={
          bill.state.items.filter((it) => it.assignedTo.length === 0).length
        }
      />

      <main className={styles.main}>
        {currentStep === 'entry' && (
          <BillEntry
            items={bill.state.items}
            onAddItem={bill.addItem}
            onAddItems={bill.addItems}
            onUpdateItem={bill.updateItem}
            onRemoveItem={bill.removeItem}
            onSetTaxAmount={bill.setTaxAmount}
            onSetTipAmount={bill.setTipAmount}
            onSetTipMode={bill.setTipMode}
            onNext={() => bill.setStep('assign')}
          />
        )}
        {currentStep === 'assign' && (
          <Assignment
            items={bill.state.items}
            people={bill.state.people}
            onToggleAssignment={bill.toggleAssignment}
            onSetPartySize={bill.setPartySize}
            onNext={() => bill.setStep('summary')}
          />
        )}
        {currentStep === 'summary' && (
          <Summary
            items={bill.state.items}
            people={bill.state.people}
            taxAmount={bill.state.taxAmount}
            tipAmount={bill.state.tipAmount}
            tipMode={bill.state.tipMode}
            taxTipSplit={bill.state.taxTipSplit}
            onSetTaxAmount={bill.setTaxAmount}
            onSetTipAmount={bill.setTipAmount}
            onSetTipMode={bill.setTipMode}
            onSetTaxTipSplit={bill.setTaxTipSplit}
          />
        )}
      </main>
    </div>
  )
}
