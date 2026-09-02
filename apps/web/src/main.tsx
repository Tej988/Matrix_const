import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { envError } from './lib/env'
import { SetupNeeded } from './app/SetupNeeded'
import { FatalError } from './app/FatalError'

const container = document.getElementById('root')
if (!container) throw new Error('No #root element in index.html')

const root = createRoot(container)

/**
 * A startup failure must never render as a blank page. Anything thrown before
 * React mounts - a bad import, a duplicate SDK copy, a Firebase misconfiguration -
 * is caught here and shown, because "blank dark screen" is unactionable for
 * whoever hits it.
 */
function renderFatal(error: unknown) {
  console.error('[startup]', error)
  root.render(
    <StrictMode>
      <FatalError error={error} />
    </StrictMode>,
  )
}

window.addEventListener('unhandledrejection', (e) => renderFatal(e.reason))

try {
  if (envError) {
    root.render(
      <StrictMode>
        <SetupNeeded missing={envError} />
      </StrictMode>,
    )
  } else {
    // Configuration is checked before the app is imported, because importing
    // the app imports Firebase, which cannot initialise without it.
    const { App } = await import('./app/App')
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  }
} catch (error) {
  renderFatal(error)
}
