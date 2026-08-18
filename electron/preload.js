const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  getWsUrl: () => ipcRenderer.invoke('get-ws-url'),
  reportAutoConnectProgress: (snapshot) => ipcRenderer.send('auto-connect-progress', snapshot),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  showAutoConnectWindow: () => ipcRenderer.invoke('show-auto-connect-window'),
  onAutoConnectProgress: (callback) => subscribe('auto-connect-progress', callback),
  onRestartAutoConnect: (callback) => subscribe('restart-auto-connect', callback),
  getMainWindowState: () => ipcRenderer.invoke('get-main-window-state'),
  setMainWindowBounds: (bounds) => ipcRenderer.invoke('set-main-window-bounds', bounds),
  resetMainWindowBounds: () => ipcRenderer.invoke('reset-main-window-bounds'),
  onMainWindowBoundsChanged: (callback) => subscribe('main-window-bounds-changed', callback),
  onMainWindowSaveStatus: (callback) => subscribe('main-window-save-status', callback),
  getPresentationState: () => ipcRenderer.invoke('get-presentation-state'),
  setPresentationMode: (mode) => ipcRenderer.invoke('set-presentation-mode', mode),
  setStageBackgroundKind: (kind) => ipcRenderer.invoke('set-stage-background-kind', kind),
  beginStagePersonEditing: () => ipcRenderer.invoke('begin-stage-person-editing'),
  beginDesktopPetEditing: () => ipcRenderer.invoke('begin-desktop-pet-editing'),
  updateDesktopPetBounds: (bounds) => ipcRenderer.invoke('update-desktop-pet-bounds', bounds),
  saveDesktopPetEditing: () => ipcRenderer.invoke('save-desktop-pet-editing'),
  cancelDesktopPetEditing: () => ipcRenderer.invoke('cancel-desktop-pet-editing'),
  saveStagePersonLayout: (layout) => ipcRenderer.invoke('save-stage-person-layout', layout),
  cancelStagePersonEditing: () => ipcRenderer.invoke('cancel-stage-person-editing'),
  requestApplicationQuit: () => ipcRenderer.invoke('request-application-quit'),
  onPresentationStateChanged: (callback) => subscribe('presentation-state-changed', callback),
  onValidateStageMedia: (callback) => subscribe('validate-stage-media', callback),
  resolveStageMediaValidation: (result) => ipcRenderer.send('stage-media-validation-result', result),
  reportStageMediaFailure: (result) => ipcRenderer.send('stage-media-render-failure', result),
  onNonModalNotification: (callback) => subscribe('non-modal-notification', callback),
})
