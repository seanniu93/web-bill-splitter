import { useState } from 'react'
import type { BillItem, Person } from '../../types'
import { formatCents } from '../../utils/format'
import styles from './Assignment.module.css'

interface Props {
  items: BillItem[]
  people: Person[]
  onToggleAssignment: (itemId: string, personName: string) => void
  onSetPartySize: (personName: string, size: number) => void
  onNext: () => void
}

export function Assignment({
  items,
  people,
  onToggleAssignment,
  onSetPartySize,
  onNext,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [newPersonInput, setNewPersonInput] = useState('')

  const allPeopleNames = people.map((p) => p.name)
  const unassignedCount = items.filter((it) => it.assignedTo.length === 0).length

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
    setNewPersonInput('')
  }

  const handleAddPerson = (itemId: string) => {
    const trimmed = newPersonInput.trim()
    if (!trimmed) return
    onToggleAssignment(itemId, trimmed)
    setNewPersonInput('')
  }

  if (items.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <p className={styles.emptyText}>No items to assign</p>
          <p className={styles.emptyHint}>
            Go back to the Items tab to add items first.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* People summary bar */}
      {people.length > 0 && (
        <div className={styles.peopleSummary}>
          <div className={styles.peopleChips}>
            {people.map((p) => (
              <span key={p.name} className={styles.personChipSmall}>
                {p.name}
                {p.partySize > 1 && (
                  <span className={styles.partySizeBadge}>
                    {p.partySize}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Item list */}
      <ul className={styles.list}>
        {items.map((item) => {
          const isExpanded = expandedId === item.id
          const isAssigned = item.assignedTo.length > 0
          return (
            <li
              key={item.id}
              className={`${styles.item} ${!isAssigned ? styles.unassigned : ''}`}
            >
              <button
                className={styles.itemHeader}
                onClick={() => toggleExpand(item.id)}
              >
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{item.name}</span>
                  <span className={styles.itemPrice}>
                    {formatCents(item.price)}
                  </span>
                </div>
                {item.assignedTo.length > 0 ? (
                  <div className={styles.assignedChips}>
                    {item.assignedTo.map((name) => (
                      <span key={name} className={styles.chipMini}>
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className={styles.unassignedLabel}>Tap to assign</span>
                )}
              </button>

              {isExpanded && (
                <div className={styles.assignPanel}>
                  {/* Existing people as toggle chips */}
                  {allPeopleNames.length > 0 && (
                    <div className={styles.chipGroup}>
                      {allPeopleNames.map((name) => {
                        const isOn = item.assignedTo.includes(name)
                        return (
                          <button
                            key={name}
                            className={`${styles.chip} ${isOn ? styles.chipActive : ''}`}
                            onClick={() =>
                              onToggleAssignment(item.id, name)
                            }
                          >
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Add new person */}
                  <div className={styles.addPerson}>
                    <input
                      className={styles.personInput}
                      type="text"
                      placeholder="Add person..."
                      value={newPersonInput}
                      onChange={(e) => setNewPersonInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddPerson(item.id)
                      }}
                      autoFocus
                    />
                    <button
                      className={styles.addPersonBtn}
                      onClick={() => handleAddPerson(item.id)}
                      disabled={!newPersonInput.trim()}
                    >
                      Add
                    </button>
                  </div>

                  {/* Party size controls for assigned people */}
                  {item.assignedTo.length > 0 && (
                    <div className={styles.partySizeSection}>
                      <p className={styles.partySizeLabel}>Party size</p>
                      {item.assignedTo.map((name) => {
                        const person = people.find((p) => p.name === name)
                        const size = person?.partySize ?? 1
                        return (
                          <div key={name} className={styles.partySizeRow}>
                            <span className={styles.partySizeName}>
                              {name}
                            </span>
                            <div className={styles.stepper}>
                              <button
                                className={styles.stepperBtn}
                                onClick={() =>
                                  onSetPartySize(name, size - 1)
                                }
                                disabled={size <= 1}
                              >
                                &minus;
                              </button>
                              <span className={styles.stepperValue}>
                                {size}
                              </span>
                              <button
                                className={styles.stepperBtn}
                                onClick={() =>
                                  onSetPartySize(name, size + 1)
                                }
                              >
                                +
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Footer */}
      <div className={styles.footer}>
        {unassignedCount > 0 && (
          <p className={styles.warning}>
            {unassignedCount} item{unassignedCount > 1 ? 's' : ''} not assigned
          </p>
        )}
        <button className={styles.nextBtn} onClick={onNext}>
          Next: Summary
        </button>
      </div>
    </div>
  )
}
