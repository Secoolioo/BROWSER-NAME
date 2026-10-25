// Runtime spike: node:sqlite in a utility process, moving a WebContentsView between
// windows without a reload, and an inventory of web platform APIs.
// Usage: electron . --spike=all|sqlite|reparent|inventory --out=result.json
import { app, BaseWindow, WebContentsView, utilityProcess } from 'electron';
import { createServer } from 'node:http';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const which = arg('spike', 'all');
const out = arg('out', join(process.cwd(), 'result.json'));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`${label} timed out after ${ms} ms`);
    }),
  ]);
}

async function sqliteSpike() {
  const child = utilityProcess.fork(join(here, 'sqlite-worker.mjs'), [app.getPath('temp')], {
    serviceName: 'data-service-spike',
  });
  const result = await withTimeout(
    new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('exit', (code) => reject(new Error(`worker exited with ${code}`)));
    }),
    120_000,
    'sqlite worker',
  );
  child.kill();
  return result;
}

function serve(html) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function reparentSpike() {
  const page = `<!doctype html><title>reparent</title>
<input id="field"><div style="height:5000px">tall</div>
<script>window.__bootId = Math.random().toString(36).slice(2); window.__ticks = 0;
setInterval(() => window.__ticks++, 50);</script>`;
  const server = await serve(page);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const a = new BaseWindow({ width: 800, height: 600, x: 0, y: 0 });
  const b = new BaseWindow({ width: 800, height: 600, x: 820, y: 0 });
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
  let loads = 0;
  view.webContents.on('did-start-loading', () => loads++);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  a.contentView.addChildView(view);
  await view.webContents.loadURL(url);
  const js = (code) => view.webContents.executeJavaScript(code);
  await js(`document.getElementById('field').value = 'typed'; window.scrollTo(0, 1234); 1`);
  const before = {
    bootId: await js('window.__bootId'),
    pid: view.webContents.getOSProcessId(),
    loads,
  };
  const t0 = performance.now();
  a.contentView.removeChildView(view);
  b.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  const moveMs = performance.now() - t0;
  await delay(1000);
  const ticksA = await js('window.__ticks');
  await delay(500);
  const after = {
    bootId: await js('window.__bootId'),
    field: await js(`document.getElementById('field').value`),
    scrollY: await js('window.scrollY'),
    pid: view.webContents.getOSProcessId(),
    loads,
    ticking: (await js('window.__ticks')) > ticksA,
    visible: await js('document.visibilityState'),
  };
  view.webContents.focus();
  const focused = view.webContents.isFocused();
  a.destroy();
  b.destroy();
  view.webContents.close();
  server.close();
  return {
    moveMs: Math.round(moveMs * 100) / 100,
    noReload: before.bootId === after.bootId && after.loads === before.loads,
    sameProcess: before.pid === after.pid,
    stateKept: after.field === 'typed' && after.scrollY === 1234,
    focusedAfterMove: focused,
    before,
    after,
  };
}

async function inventorySpike() {
  const page = readFileSync(join(here, 'inventory.html'), 'utf8');
  const server = await serve(page);
  const win = new BaseWindow({ width: 800, height: 600, show: false });
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
  win.contentView.addChildView(view);
  await view.webContents.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const result = await withTimeout(
    view.webContents.executeJavaScript('window.__inventory'),
    60_000,
    'inventory',
  );
  win.destroy();
  server.close();
  return result;
}

const spikes = { sqlite: sqliteSpike, reparent: reparentSpike, inventory: inventorySpike };

app.whenReady().then(async () => {
  const report = {
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    ozone: app.commandLine.getSwitchValue('ozone-platform') || null,
    sandboxed: app.commandLine.hasSwitch('no-sandbox') ? false : true,
    results: {},
  };
  for (const [name, run] of Object.entries(spikes)) {
    if (which !== 'all' && which !== name) continue;
    const started = performance.now();
    try {
      report.results[name] = { ok: true, ms: 0, data: await run() };
    } catch (error) {
      report.results[name] = { ok: false, error: String(error?.stack ?? error) };
    }
    report.results[name].ms = Math.round(performance.now() - started);
  }
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.results, (k, v) => (k === 'globals' ? `[${v.length}]` : v), 2));
  app.exit(0);
});

app.on('window-all-closed', () => {});
