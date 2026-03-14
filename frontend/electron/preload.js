const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  exec: (command, args) => ipcRenderer.invoke('shell:exec', command, args),
  onLog: (callback) => ipcRenderer.on('shell:stdout', (event, value) => callback(value)),
  resize: (mode) => ipcRenderer.send('window:resize', mode),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
});
