/**
 * electronPolyfill.ts - stubs window.electronAPI for the web runtime.
 * Desktop code accesses Electron-only APIs via optional chaining (?.on, ?.app?.flashFrame).
 * Providing a stub object prevents runtime errors; events simply never fire.
 */
if (typeof window !== 'undefined' && !(window as Record<string, unknown>).electronAPI) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electronAPI = {
    on: (_channel: string, _cb: (...args: unknown[]) => void): (() => void) => () => {},
    removeAllListeners: (_channel: string): void => {},
    app: {
      setBadge: () => {},
      openThread: () => {},
      sendBadgeImage: () => {},
      flashFrame: () => {},
    },
    window: {
      minimize: () => {},
      maximize: () => {},
      close: () => {},
      quit: () => {},
      isMaximized: async () => false,
    },
    shell: {
      openExternal: (url: string) => { if (typeof window !== 'undefined') window.open(url, '_blank') },
      openPath: async () => ({ success: false, error: 'not supported' }),
      openInApp: async () => ({ success: false, error: 'not supported' }),
    },
    util: {
      fetchUrl: async () => ({ success: false, error: 'not supported' }),
    },
    update: {
      download: () => {},
      install: () => {},
    },
    lockScreen: {
      status: async () => ({ success: true, enabled: false }),
      setup: async () => ({ success: false }),
      verify: async () => ({ success: false }),
      verifyRecovery: async () => ({ success: false }),
      changePassword: async () => ({ success: false }),
      resetPassword: async () => ({ success: false }),
      disable: async () => ({ success: false }),
      getRecoveryKey: async () => ({ success: false }),
      setBiometric: async () => ({ success: false }),
      biometricUnlock: async () => ({ success: false }),
    },
    // All other namespaces return stub objects so ?.method() calls don't throw
    login: {},
    zalo: {},
    db: {},
    file: {},
    crm: {},
    analytics: {},
    workflow: {},
    integration: {},
    ai: {},
    tunnel: {},
    employee: {},
    workspace: {},
    relay: {},
    sync: {},
    fb: {},
    proxy: {},
    erp: {},
  }
}

export {}
