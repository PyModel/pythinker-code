/// <reference types="vite/client" />

// Injected by Vite `define` (see vite.config.ts): the dev proxy's upstream
// daemon target, so the UI can display which daemon it actually talks to.
// In production builds this is still defined but unused (same-origin daemon).
declare const __PYTHINKER_DEV_PROXY_TARGET__: string;

// Injected by Vite `define` from apps/pythinker-web/package.json.
declare const __PYTHINKER_WEB_VERSION__: string;

type DesktopUpdateState = {
  status: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
  autoUpdate: boolean;
};

interface PythinkerDesktopBridge {
  platform: string;
  getUpdateState: () => Promise<DesktopUpdateState>;
  setAutoUpdate: (enabled: boolean) => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  quitAndInstall: () => Promise<DesktopUpdateState>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  setThemeSource: (source: 'dark' | 'light' | 'system') => Promise<void>;
  onUpdateState: (callback: (state: DesktopUpdateState) => void) => () => void;
}

interface Window {
  pythinkerDesktop?: PythinkerDesktopBridge;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
