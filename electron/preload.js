const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig:      () => ipcRenderer.invoke('get-config'),
  saveConfig:     (cfg) => ipcRenderer.invoke('save-config', cfg),
  getWsUrl:       () => ipcRenderer.invoke('get-ws-url'),
  openMainWindow: () => ipcRenderer.invoke('open-main-window'),
  openSetupWindow: () => ipcRenderer.invoke('open-setup-window'),
})
