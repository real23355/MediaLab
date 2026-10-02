const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  selectFiles: () => ipcRenderer.invoke("select-files"),
  fileInfo: (filePath) => ipcRenderer.invoke("file-info", filePath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  readSlice: (filePath, start, length) =>
    ipcRenderer.invoke("read-slice", filePath, start, length),
  decodeHeic: (filePath) => ipcRenderer.invoke("decode-heic", filePath),
  probeStream: (filePath, kind, jobId) =>
    ipcRenderer.invoke("probe-stream", filePath, kind, jobId),
  createProxy: (filePath, kind, fps, frameCount, jobId) =>
    ipcRenderer.invoke("create-proxy", filePath, kind, fps, frameCount, jobId),
  resetSession: () => ipcRenderer.invoke("reset-session"),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("parse-progress", listener);
    return () => ipcRenderer.removeListener("parse-progress", listener);
  },
  appVersion: () => ipcRenderer.invoke("app-version"),
  restartApp: () => ipcRenderer.invoke("restart-app")
});
