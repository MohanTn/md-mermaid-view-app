import { contextBridge, ipcRenderer } from 'electron';
import type { ViewerApi } from '../shared/types.js';

const api: ViewerApi = {
  chooseFile: () => ipcRenderer.invoke('choose-file'),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  listDirectory: (directoryPath) => ipcRenderer.invoke('list-directory', directoryPath),
  onOpenPath: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('open-path-event', listener);
    return () => ipcRenderer.removeListener('open-path-event', listener);
  },
};

contextBridge.exposeInMainWorld('viewer', api);
