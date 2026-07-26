const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  selectFiles: () => ipcRenderer.invoke("select-files"),
  fileInfo: (filePath) => ipcRenderer.invoke("file-info", filePath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  readSlice: (filePath, start, length) =>
    ipcRenderer.invoke("read-slice", filePath, start, length),
  probeStream: (filePath, kind) =>
    ipcRenderer.invoke("probe-stream", filePath, kind),
  createProxy: (filePath, kind, fps) =>
    ipcRenderer.invoke("create-proxy", filePath, kind, fps),
  appVersion: () => ipcRenderer.invoke("app-version")
});
