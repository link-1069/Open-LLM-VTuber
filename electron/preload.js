const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig:      () => ipcRenderer.invoke('get-config'),
  saveConfig:     (cfg) => ipcRenderer.invoke('save-config', cfg),
  getWsUrl:       () => ipcRenderer.invoke('get-ws-url'),
  openMainWindow: () => ipcRenderer.invoke('open-main-window'),
  openSetupWindow: () => ipcRenderer.invoke('open-setup-window'),
  getMainWindowState: () => ipcRenderer.invoke('get-main-window-state'),
  setMainWindowBounds: (bounds) => ipcRenderer.invoke('set-main-window-bounds', bounds),
  resetMainWindowBounds: () => ipcRenderer.invoke('reset-main-window-bounds'),
  onMainWindowBoundsChanged: (callback) => subscribe('main-window-bounds-changed', callback),
  onMainWindowSaveStatus: (callback) => subscribe('main-window-save-status', callback),
})
