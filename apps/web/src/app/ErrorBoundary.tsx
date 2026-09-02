import { Component, type ErrorInfo, type ReactNode } from 'react'
import { FatalError } from './FatalError'

/**
 * Catches errors thrown during render.
 *
 * main.tsx's try/catch only covers module loading; React unmounts the whole
 * tree when a component throws while rendering, which paints a blank page and
 * tells nobody anything. Spec section 59 counts a feature incomplete without an
 * error state, and "blank screen" is the worst possible one.
 *
 * Must be a class - there is no hook equivalent for componentDidCatch.
 */
interface State {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[render]', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  override render() {
    if (this.state.error) {
      return <FatalError error={this.state.error} componentStack={this.state.componentStack} />
    }
    return this.props.children
  }
}
