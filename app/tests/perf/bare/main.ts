/**
 * The reference for the performance budgets: a bare Electron app with the browser's
 * topology and nothing else. One window holds a UI view on an in-memory session and a
 * blank tab view on a persistent one. Like the browser's self-test, it writes a report
 * when the UI has loaded and then keeps running until the harness stops it.
 */
import { app, BaseWindow, WebContentsView } from 'electron';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const reportPath = app.commandLine.getSwitchValue('smoke-test');
const toolbarHeight = 80;

void app.whenReady().then(() => {
  const window = new BaseWindow({ width: 1280, height: 800, backgroundColor: '#f7f7f8' });
  const ui = new WebContentsView({
    webPreferences: { partition: 'internal', sandbox: true, contextIsolation: true },
  });
  const tab = new WebContentsView({
    webPreferences: { partition: 'persist:default', sandbox: true, contextIsolation: true },
  });
  const layout = (): void => {
    const { width, height } = window.getContentBounds();
    ui.setBounds({ x: 0, y: 0, width, height });
    tab.setBounds({ x: 0, y: toolbarHeight, width, height: Math.max(0, height - toolbarHeight) });
  };
  window.contentView.addChildView(ui);
  window.contentView.addChildView(tab);
  window.on('resize', layout);
  layout();
  ui.webContents.once('did-finish-load', () => {
    const report = { ok: true, shellReadyMs: Math.round(performance.now()), readyAt: Date.now() };
    if (reportPath !== '') {
      // Written in one step, so the harness never reads half a report.
      writeFileSync(`${reportPath}.tmp`, `${JSON.stringify(report)}\n`);
      renameSync(`${reportPath}.tmp`, reportPath);
    }
  });
  void ui.webContents.loadURL(pathToFileURL(join(import.meta.dirname, 'index.html')).href);
  void tab.webContents.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
