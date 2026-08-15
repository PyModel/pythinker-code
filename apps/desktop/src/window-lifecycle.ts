/** Desktop window and application lifetime independent from Electron imports. */

/** Minimal close event accepted by the desktop lifecycle. */
export interface WindowCloseEvent {
  /** Keep the application alive while the window is hidden. */
  preventDefault(): void
}

/** Window operations owned by the desktop lifecycle. */
export interface DesktopWindow {
  /** Whether the native window has been destroyed. */
  isDestroyed(): boolean
  /** Whether the native window is visible. */
  isVisible(): boolean
  /** Reveal the existing window. */
  show(): void
  /** Give the existing window keyboard focus. */
  focus(): void
  /** Hide without tearing down its renderer or Host connection. */
  hide(): void
}

/** Dependencies supplied by the Electron main process. */
export interface DesktopLifecycleOptions {
  /** Return the current native window, when one exists. */
  readonly getWindow: () => DesktopWindow | undefined
  /** Create and load a replacement native window. */
  readonly createWindow: () => Promise<DesktopWindow>
  /** Stop the desktop-owned Host and reach process quiescence. */
  readonly disposeHost: () => Promise<void>
  /** Retry Electron's ordinary quit after asynchronous teardown completes. */
  readonly quit: () => void
  /** Report a teardown failure before the retry is released. */
  readonly reportError?: (error: unknown) => void
}

/** Public controller for close, restore and explicit quit events. */
export interface DesktopLifecycle {
  /** True after an explicit application quit begins. */
  readonly isQuitting: boolean
  /** Current quit operation, shared by every quit source. */
  readonly pendingQuit: Promise<void> | undefined
  /** Hide an ordinary close, or let it proceed during explicit quit. */
  onWindowClose(event: WindowCloseEvent): void
  /** Show the existing window or create a replacement. */
  showWindow(): Promise<void>
  /** Dispose the Host once, then release Electron's quit sequence. */
  requestQuit(): Promise<void>
}

/**
 * Create the desktop application lifecycle.
 * @param options - Native window access, Host teardown and quit release.
 * @returns A lifecycle whose Host outlives ordinary window closes.
 */
export function createDesktopLifecycle(options: DesktopLifecycleOptions): DesktopLifecycle {
  let quitting = false
  let pendingQuit: Promise<void> | undefined
  let creatingWindow: Promise<DesktopWindow> | undefined

  const showWindow = async (): Promise<void> => {
    if (quitting) return
    let window = options.getWindow()
    if (window === undefined || window.isDestroyed()) {
      creatingWindow ??= options.createWindow().finally(() => { creatingWindow = undefined })
      window = await creatingWindow
    }
    if (!window.isVisible()) window.show()
    window.focus()
  }

  const requestQuit = (): Promise<void> => {
    if (pendingQuit !== undefined) return pendingQuit
    quitting = true
    pendingQuit = options.disposeHost().catch((error: unknown) => {
      options.reportError?.(error)
    }).then(() => {
      options.quit()
    })
    return pendingQuit
  }

  return {
    get isQuitting() { return quitting },
    get pendingQuit() { return pendingQuit },
    onWindowClose(event) {
      if (quitting) return
      event.preventDefault()
      options.getWindow()?.hide()
    },
    showWindow,
    requestQuit,
  }
}
