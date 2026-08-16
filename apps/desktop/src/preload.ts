import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pythinkerDesktop', {
  platform: process.platform,
  getUpdateState: () => ipcRenderer.invoke('pythinker:update:get'),
  setAutoUpdate: (enabled: boolean) => ipcRenderer.invoke('pythinker:update:set-auto', enabled),
  checkForUpdates: () => ipcRenderer.invoke('pythinker:update:check'),
  quitAndInstall: () => ipcRenderer.invoke('pythinker:update:install'),
  setThemeSource: (source: 'dark' | 'light' | 'system') =>
    ipcRenderer.invoke('pythinker:theme:set-source', source),
  onUpdateState: (cb: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => cb(state)
    ipcRenderer.on('pythinker:update:state', listener)
    return () => ipcRenderer.removeListener('pythinker:update:state', listener)
  },
})
