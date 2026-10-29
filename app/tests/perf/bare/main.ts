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
const marks: Record<string, number> = { main: Math.round(performance.now()) };
// Wall-clock time at which these milliseconds start, to add the UI page's own timing.
const timeOrigin = Date.now() - performance.now();
const toolbarHeight = 80;
// Returns the wall-clock time of each step of the UI page's load. The browser's self-test
// (app/src/main/smoke-test.ts) reads its shell with the same script.
const pageTimingScript = `(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const times = {
    'page.fetch': n?.fetchStart,
    'page.responseEnd': n?.responseEnd,
    'page.interactive': n?.domInteractive,
    'page.domReady': n?.domContentLoadedEventStart,
    'page.domReadyEnd': n?.domContentLoadedEventEnd,
    'page.loadStart': n?.loadEventStart,
  };
  for (const mark of performance.getEntriesByType('mark')) times['page.' + mark.name] = mark.startTime;
  const steps = [['page.start', 0], ...Object.entries(times).filter(([, time]) => time > 0)];
  return Object.fromEntries(steps.map(([name, time]) => [name, performance.timeOrigin + time]));
})()`;

void app.whenReady().then(() => {
  marks['ready'] = Math.round(performance.now());
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
  marks['window'] = Math.round(performance.now());
  ui.webContents.once('did-finish-load', () => {
    marks['shell'] = Math.round(performance.now());
    const readyAt = Date.now();
    if (reportPath === '') return;
    // Read only now, so that reading does not delay the ready time.
    void ui.webContents
      .executeJavaScript(pageTimingScript)
      .catch(() => ({}))
      .then((times: Record<string, number>) => {
        for (const [name, time] of Object.entries(times)) {
          marks[name] = Math.round(time - timeOrigin);
        }
        const report = { ok: true, shellReadyMs: marks['shell'], readyAt, marks };
        // Written in one step, so the harness never reads half a report.
        writeFileSync(`${reportPath}.tmp`, `${JSON.stringify(report)}\n`);
        renameSync(`${reportPath}.tmp`, reportPath);
      });
  });
  void ui.webContents.loadURL(pathToFileURL(join(import.meta.dirname, 'index.html')).href);
  void tab.webContents.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
