// Reports whether renderers run in their own user namespace (Chromium namespace sandbox)
// and whether the SUID helper or no sandbox is in use.
import { app, BaseWindow, WebContentsView } from 'electron';
import { readlinkSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ns = (pid) => {
  try {
    return readlinkSync(`/proc/${pid}/ns/user`);
  } catch (error) {
    return `error: ${error.code}`;
  }
};

app.whenReady().then(async () => {
  const win = new BaseWindow({ width: 400, height: 300, show: false });
  const view = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(view);
  await view.webContents.loadURL('about:blank');
  const renderer = view.webContents.getOSProcessId();
  let helper = null;
  try {
    const s = statSync(join(dirname(process.execPath), 'chrome-sandbox'));
    helper = { mode: (s.mode & 0o7777).toString(8), uid: s.uid };
  } catch {}
  const result = {
    execPath: process.execPath,
    appImage: process.env.APPIMAGE ?? null,
    noSandboxSwitch: app.commandLine.hasSwitch('no-sandbox'),
    mainUserNs: ns(process.pid),
    rendererUserNs: ns(renderer),
    rendererInOwnUserNs: ns(process.pid) !== ns(renderer),
    chromeSandbox: helper,
  };
  writeFileSync(process.env.SPIKE_OUT ?? 'sandbox.json', JSON.stringify(result));
  app.exit(0);
});
