const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wali', {
  savePDF: (name, bare) => ipcRenderer.invoke('save-pdf', name, bare),
  saveFile: (name, content) => ipcRenderer.invoke('save-file', name, content),
  autoBackup: (name, content) => ipcRenderer.invoke('auto-backup', name, content),
  openBackups: () => ipcRenderer.invoke('open-backups'),
})
