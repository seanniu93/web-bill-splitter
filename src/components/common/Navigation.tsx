import type { Step } from '../../types'
import styles from './Navigation.module.css'

interface Props {
  currentStep: Step
  onStepChange: (step: Step) => void
  itemCount: number
  unassignedCount: number
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'entry', label: 'Items' },
  { key: 'assign', label: 'Assign' },
  { key: 'summary', label: 'Summary' },
]

export function Navigation({
  currentStep,
  onStepChange,
  itemCount,
  unassignedCount,
}: Props) {
  return (
    <nav className={styles.nav}>
      {STEPS.map(({ key, label }) => {
        const isActive = currentStep === key
        const badge =
          key === 'entry'
            ? itemCount > 0
              ? String(itemCount)
              : undefined
            : key === 'assign' && unassignedCount > 0
              ? String(unassignedCount)
              : undefined

        return (
          <button
            key={key}
            className={`${styles.tab} ${isActive ? styles.active : ''}`}
            onClick={() => onStepChange(key)}
          >
            {label}
            {badge && (
              <span
                className={`${styles.badge} ${
                  key === 'assign' ? styles.badgeWarning : ''
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
