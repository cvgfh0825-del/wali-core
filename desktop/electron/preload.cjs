const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wali', {
  savePDF: (name) => ipcRenderer.invoke('save-pdf', name),
  saveFile: (name, content) => ipcRenderer.invoke('save-file', name, content),
  autoBackup: (name, content) => ipcRenderer.invoke('auto-backup', name, content),
  openBackups: () => ipcRenderer.invoke('open-backups'),
})
