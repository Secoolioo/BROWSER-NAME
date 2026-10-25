import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { shellChannels, shellEventChannels } from '../shared/ipc/shell-channels.ts';

const requests = new Set<string>(shellChannels);
const events = new Set<string>(shellEventChannels);

/**
 * The only API the shell page gets. It can call the shell's request channels and listen
 * to its event channels; there is no generic access to `ipcRenderer`.
 */
contextBridge.exposeInMainWorld('bridge', {
  invoke(channel: string, payload: unknown): Promise<unknown> {
    if (!requests.has(channel)) {
      return Promise.reject(new Error(`Unknown channel ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: string, listener: (payload: unknown) => void): () => void {
    if (!events.has(channel)) {
      throw new Error(`Unknown event ${channel}`);
    }
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.off(channel, wrapped);
  },
});
