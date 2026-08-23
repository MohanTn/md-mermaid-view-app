import { contextBridge, ipcRenderer } from 'electron';
import type { ViewerApi } from '../shared/types.js';

const api: ViewerApi = {
  chooseFile: () => ipcRenderer.invoke('choose-file'),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  listDirectory: (directoryPath) => ipcRenderer.invoke('list-directory', directoryPath),
  readSidecar: (filePath, tag) => ipcRenderer.invoke('read-sidecar', filePath, tag),
  writeSidecar: (filePath, tag, content) => ipcRenderer.invoke('write-sidecar', filePath, tag, content),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  openParquet: (filePath) => ipcRenderer.invoke('open-parquet', filePath),
  openParquetPage: (filePath, rowStart, rowEnd) => ipcRenderer.invoke('open-parquet-page', filePath, rowStart, rowEnd),
  queryParquet: (filePath, query) => ipcRenderer.invoke('parquet-query', filePath, query),
  onOpenPath: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('open-path-event', listener);
    return () => ipcRenderer.removeListener('open-path-event', listener);
  },
};

contextBridge.exposeInMainWorld('viewer', api);
