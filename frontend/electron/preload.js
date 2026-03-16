const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  exec: (command, args) => ipcRenderer.invoke('shell:exec', command, args),
  onLog: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('shell:stdout', listener);
    return () => {
      ipcRenderer.removeListener('shell:stdout', listener);
    };
  },
  resize: (mode) => ipcRenderer.send('window:resize', mode),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  openPath: (targetPath) => ipcRenderer.invoke('shell:open-path', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  killPortHolder: (port) => ipcRenderer.invoke('shell:kill-port-holder', port),
  invokeChat: (request) => ipcRenderer.invoke('openclaw:chat.invoke', request),
  abortChat: (requestId) => ipcRenderer.invoke('openclaw:chat.abort', requestId),
  onChatChunk: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('openclaw:chat.chunk', listener);
    return () => {
      ipcRenderer.removeListener('openclaw:chat.chunk', listener);
    };
  },
});
