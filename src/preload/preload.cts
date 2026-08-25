import { contextBridge, ipcRenderer } from "electron";
import type { ViewerApi } from "../shared/types.js";

const api: ViewerApi = {
  chooseFile: () => ipcRenderer.invoke("choose-file"),
  openPath: (filePath) => ipcRenderer.invoke("open-path", filePath),
  listDirectory: (directoryPath) =>
    ipcRenderer.invoke("list-directory", directoryPath),
  readSidecar: (filePath, tag) =>
    ipcRenderer.invoke("read-sidecar", filePath, tag),
  writeSidecar: (filePath, tag, content) =>
    ipcRenderer.invoke("write-sidecar", filePath, tag, content),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  openParquet: (filePath) => ipcRenderer.invoke("open-parquet", filePath),
  openParquetPage: (filePath, rowStart, rowEnd) =>
    ipcRenderer.invoke("open-parquet-page", filePath, rowStart, rowEnd),
  queryParquet: (filePath, query) =>
    ipcRenderer.invoke("parquet-query", filePath, query),
  onOpenPath: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, filePath: string) =>
      callback(filePath);
    ipcRenderer.on("open-path-event", listener);
    return () => ipcRenderer.removeListener("open-path-event", listener);
  },

  // ── Code graph ──
  openWorkspace: () => ipcRenderer.invoke("choose-workspace"),
  scanWorkspace: (directoryPath) =>
    ipcRenderer.invoke("scan-workspace", directoryPath),
  cancelScan: () => ipcRenderer.invoke("cancel-scan"),
  getNodeDetail: (nodeId) => ipcRenderer.invoke("get-node-detail", nodeId),
  saveGraphLayout: (workspaceRoot, positions) =>
    ipcRenderer.invoke("save-graph-layout", workspaceRoot, positions),
  onScanProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) =>
      callback(message);
    ipcRenderer.on("scan-progress", listener);
    return () => ipcRenderer.removeListener("scan-progress", listener);
  },
};

contextBridge.exposeInMainWorld("viewer", api);
