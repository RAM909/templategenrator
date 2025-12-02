const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  selectFile: (filters) => ipcRenderer.invoke("select-file", { filters }),
  selectMultipleFiles: (filters) => ipcRenderer.invoke("select-multiple-files", { filters }),
  selectOutputFolder: () => ipcRenderer.invoke("select-output-folder"),
  runTransform: (payload) => ipcRenderer.invoke("run-transform", payload),
  onProgress: (callback) => {
    ipcRenderer.on("transform-progress", (_, event) => callback(event));
  },
  openFolder: (folderPath) => ipcRenderer.invoke("open-folder", folderPath)
});
