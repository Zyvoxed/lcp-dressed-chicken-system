import { createContext, useLayoutEffect, useMemo, useState } from 'react'

/* eslint-disable react-refresh/only-export-components */
export const ThemeContext = createContext(null)

const storageKey = 'theme'
const defaultTheme = 'dark'

function getStoredTheme() {
  try {
    const storedTheme = localStorage.getItem(storageKey)
    return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : defaultTheme
  } catch {
    return defaultTheme
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getStoredTheme)

  useLayoutEffect(() => {
    document.body.classList.remove('light-theme', 'dark-theme')
    document.body.classList.add(`${theme}-theme`)
    try {
      localStorage.setItem(storageKey, theme)
    } catch {
      // Theme still applies even when storage is unavailable.
    }
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark')),
    }),
    [theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
