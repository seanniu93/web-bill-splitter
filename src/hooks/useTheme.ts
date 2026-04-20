import { useState, useEffect, useCallback } from 'react'

type ThemeSetting = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'bill-splitter-theme'

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function resolveTheme(setting: ThemeSetting): ResolvedTheme {
  return setting === 'system' ? getSystemTheme() : setting
}

function loadSetting(): ThemeSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // ignore
  }
  return 'system'
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute(
    'data-theme',
    resolved,
  )
  // Update meta theme-color for mobile browser chrome
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#111111' : '#ffffff')
  }
}

export function useTheme() {
  const [setting, setSetting] = useState<ThemeSetting>(loadSetting)
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(loadSetting()),
  )

  // Apply theme to DOM whenever resolved theme changes
  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  // Listen for system theme changes when setting is 'system'
  useEffect(() => {
    if (setting !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setResolved(getSystemTheme())
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [setting])

  const cycleSetting = useCallback(() => {
    setSetting((prev) => {
      const order: ThemeSetting[] = ['system', 'light', 'dark']
      const next = order[(order.indexOf(prev) + 1) % order.length]
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore
      }
      setResolved(resolveTheme(next))
      return next
    })
  }, [])

  return { setting, resolved, cycleSetting }
}
