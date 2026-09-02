import { useEffect, useState } from 'react'

/**
 * Whether the browser thinks it has a connection.
 *
 * `navigator.onLine` is a weak signal - it reports link state, not whether
 * Firestore is actually reachable - but for the purpose it serves here (telling
 * a supervisor their marks are queued rather than lost) it is honest enough,
 * and it never blocks the write either way.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
