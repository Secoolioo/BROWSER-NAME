import { contextBridge, ipcRenderer } from 'electron';

const scopeArgument = process.argv.find((arg) => arg.startsWith('--bridge-scope='));
const scope = scopeArgument?.slice('--bridge-scope='.length) ?? '';

/**
 * Bridge for internal pages. Each page may only call the channels of its own scope, such as
 * `sandboxHelp.*`; the browser process checks the page's capability again.
 */
contextBridge.exposeInMainWorld('bridge', {
  invoke(channel: string, payload: unknown): Promise<unknown> {
    if (scope === '' || !channel.startsWith(`${scope}.`)) {
      return Promise.reject(new Error(`Channel ${channel} is not available on this page`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
});
