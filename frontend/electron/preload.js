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
  getWindowMode: () => ipcRenderer.invoke('window:get-mode'),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  openPath: (targetPath) => ipcRenderer.invoke('shell:open-path', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  killPortHolder: (port) => ipcRenderer.invoke('shell:kill-port-holder', port),
  findFreePort: (startPort, endPort) => ipcRenderer.invoke('port:find-free', startPort, endPort),
  setTitle: (title) => ipcRenderer.invoke('window:set-title', title),
  ackEvent: (payload) => ipcRenderer.invoke('events:ack', payload),
  getEventState: (payload) => ipcRenderer.invoke('events:state', payload),
  scanSessions: (payload) => ipcRenderer.invoke('usage:scan-sessions', payload),
  invokeChat: (request) => ipcRenderer.invoke('openclaw:chat.invoke', request),
  abortChat: (requestId) => ipcRenderer.invoke('openclaw:chat.abort', requestId),
  ensureGatewayWs: () => ipcRenderer.invoke('openclaw:gateway.ws-ensure'),
  listChatSessions: (payload) => ipcRenderer.invoke('openclaw:sessions.list', payload ? JSON.stringify(payload) : undefined),
  loadChatSession: (payload) => ipcRenderer.invoke('openclaw:session.load', payload),
  listActivityEvents: (payload) => ipcRenderer.invoke('activity:events:list', payload ? JSON.stringify(payload) : undefined),
  scanActivityNow: (payload) => ipcRenderer.invoke('activity:scan:now', payload ? JSON.stringify(payload) : undefined),
  restartActivityWatcher: (payload) => ipcRenderer.invoke('activity:watch:restart', payload ? JSON.stringify(payload) : undefined),
  launchChromeDebug: (port) => ipcRenderer.invoke('browser:launch-chrome-debug', port),
  checkChromeDebug: (port) => ipcRenderer.invoke('browser:check-chrome-debug', port),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:write-file', filePath, content),
  readFileEncoded: (filePath, encoding) => ipcRenderer.invoke('fs:read-file-encoded', filePath, encoding),
  detectEncoding: (filePath) => ipcRenderer.invoke('fs:detect-encoding', filePath),
  readFileBase64: (filePath) => ipcRenderer.invoke('fs:read-file-base64', filePath),
  onChatChunk: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('openclaw:chat.chunk', listener);
    return () => {
      ipcRenderer.removeListener('openclaw:chat.chunk', listener);
    };
  },
  onGatewayStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('openclaw:gateway.status', listener);
    return () => {
      ipcRenderer.removeListener('openclaw:gateway.status', listener);
    };
  },
  scanActiveSessions: (payload) => ipcRenderer.invoke('openclaw:sessions.scan', payload ? JSON.stringify(payload) : undefined),
  abortSession: (payload) => ipcRenderer.invoke('openclaw:session.abort', payload ? JSON.stringify(payload) : undefined),
});
