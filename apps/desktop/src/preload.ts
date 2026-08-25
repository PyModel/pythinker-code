import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pythinkerDesktop', {
  platform: process.platform,
  getUpdateState: () => ipcRenderer.invoke('pythinker:update:get'),
  setAutoUpdate: (enabled: boolean) => ipcRenderer.invoke('pythinker:update:set-auto', enabled),
  setUpdateChannel: (channel: 'stable' | 'beta' | 'nightly') =>
    ipcRenderer.invoke('pythinker:update:set-channel', channel),
  checkForUpdates: () => ipcRenderer.invoke('pythinker:update:check'),
  downloadUpdate: () => ipcRenderer.invoke('pythinker:update:download'),
  cancelUpdateDownload: () => ipcRenderer.invoke('pythinker:update:cancel'),
  skipUpdate: (version: string) => ipcRenderer.invoke('pythinker:update:skip', version),
  undoSkippedUpdate: () => ipcRenderer.invoke('pythinker:update:undo-skip'),
  markUpdateNotified: (version: string) => ipcRenderer.invoke('pythinker:update:notified', version),
  acknowledgeCompletedUpdate: (version: string) => ipcRenderer.invoke('pythinker:update:ack-completed', version),
  openUpdateReleaseNotes: (version: string) => ipcRenderer.invoke('pythinker:update:open-notes', version),
  restartToUpdate: () => ipcRenderer.invoke('pythinker:update:install'),
  minimizeWindow: () => ipcRenderer.invoke('pythinker:window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('pythinker:window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('pythinker:window:close'),
  setThemeSource: (source: 'dark' | 'light' | 'system') =>
    ipcRenderer.invoke('pythinker:theme:set-source', source),
  onUpdateState: (cb: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => cb(state)
    ipcRenderer.on('pythinker:update:state', listener)
    return () => ipcRenderer.removeListener('pythinker:update:state', listener)
  },
})
