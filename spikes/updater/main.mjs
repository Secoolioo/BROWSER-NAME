// Update spike app. Without arguments it records its version and quits. With
// --check-update=<feed url> it checks the signed feed, downloads and installs silently.
import { app } from 'electron';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import updater from 'electron-updater';
import { SignedFeedProvider } from './provider.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const stateDir = app.getPath('userData');
mkdirSync(stateDir, { recursive: true });
const logFile = join(stateDir, 'spike.log');
const log = (level, ...parts) =>
  appendFileSync(logFile, `${new Date().toISOString()} ${level} ${parts.join(' ')}\n`);
const variant = JSON.parse(readFileSync(join(here, 'variant.json'), 'utf8'));

function record(extra = {}) {
  const file = join(stateDir, 'spike-state.json');
  let runs = [];
  try {
    runs = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  runs.push({ version: app.getVersion(), variant, at: new Date().toISOString(), ...extra });
  writeFileSync(file, JSON.stringify(runs, null, 2));
}

function formatName() {
  if (process.platform === 'win32') return 'nsis';
  if (process.platform === 'darwin') return 'zip';
  return 'appimage';
}

async function checkUpdate(url, expect) {
  const { autoUpdater } = updater;
  autoUpdater.logger = {
    info: (m) => log('info', m),
    warn: (m) => log('warn', m),
    error: (m) => log('error', m),
    debug: (m) => log('debug', m),
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({
    provider: 'custom',
    updateProvider: SignedFeedProvider,
    url,
    channel: 'stable',
    format: formatName(),
    stateFile: join(stateDir, 'feed-state.json'),
    publicKeys: [readFileSync(join(here, 'keys', 'feed-current.pem'), 'utf8')],
  });
  let progress = null;
  autoUpdater.on('download-progress', (p) => (progress = p));
  try {
    const result = await autoUpdater.checkForUpdates();
    const available = result?.isUpdateAvailable ?? false;
    if (!available) {
      record({ mode: 'check', expect, outcome: 'no-update' });
      return app.exit(expect === 'no-update' ? 0 : 1);
    }
    await result.downloadPromise;
    record({ mode: 'check', expect, outcome: 'downloaded', progress });
    if (expect !== 'install') return app.exit(1);
    log('info', 'installing');
    autoUpdater.quitAndInstall(true, true);
  } catch (error) {
    record({
      mode: 'check',
      expect,
      outcome: 'error',
      code: error?.code ?? null,
      message: String(error?.message ?? error),
    });
    app.exit(expect && expect.startsWith('ERR_') && error?.code === expect ? 0 : 1);
  }
}

app.whenReady().then(() => {
  const url = arg('check-update');
  if (!url) {
    record({ mode: 'start' });
    setTimeout(() => app.quit(), 1000);
    return;
  }
  checkUpdate(url, arg('expect'));
});
app.on('window-all-closed', () => {});
