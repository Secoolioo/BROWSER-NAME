import { app, type WebContents } from 'electron';
import { readlinkSync } from 'node:fs';
import { writeFileAtomicSync } from '../platform/node/atomic-file.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';

/** The report that a packaged build writes in self-test mode. */
export interface SmokeReport {
  readonly ok: boolean;
  readonly version: string;
  readonly versions: Readonly<Record<string, string | undefined>>;
  readonly platform: string;
  readonly arch: string;
  readonly packaged: boolean;
  /** Milliseconds from process start until the shell finished loading and rendered. */
  readonly shellReadyMs: number;
  /** Wall-clock time of that moment, so a harness can measure from the spawn. */
  readonly readyAt: number;
  /**
   * Milliseconds since process start at each start-up step. The `page.*` marks come from
   * the shell page itself: its Navigation Timing and the marks that it sets.
   */
  readonly marks: Readonly<Record<string, number>>;
  readonly shellUrl: string;
  /** Whether renderer processes run inside the Chromium sandbox. */
  readonly rendererSandboxed: boolean | 'unknown';
  readonly errors: readonly string[];
}

/**
 * Runs in the page and returns the wall-clock time of each step of its load: the start of
 * the navigation, its Navigation Timing, and every `performance.mark` of the page as
 * `page.<name>`. Steps with a time of zero did not happen and are left out. So is
 * `responseStart`: pages from `app://` and `file://` report it equal to `fetchStart`, and
 * their scripts and stylesheets get no Resource Timing entries at all. The bare reference
 * (`app/tests/perf/bare/main.ts`) runs the same script.
 */
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

/**
 * Runs the self-test of a packaged build: waits for the first window's shell and tab,
 * writes a JSON report and quits. Installers and CI use it to check every package; the
 * performance harness keeps the browser running to measure it.
 * @param window - The first window.
 * @param reportPath - Where to write the report.
 * @param options - Whether the browser stays open after the report, the start-up marks so
 *   far, and the wall-clock time at which their clock, `performance.now()`, started.
 */
export function runSmokeTest(
  window: BrowserWindowController,
  reportPath: string,
  options: {
    readonly keepRunning: boolean;
    readonly marks: Readonly<Record<string, number>>;
    readonly timeOrigin: number;
  },
): void {
  const { keepRunning } = options;
  let shellLoaded = -1;
  const errors: string[] = [];
  const finish = (
    shellReadyMs: number,
    readyAt: number,
    pageMarks: Readonly<Record<string, number>> = {},
  ): void => {
    const report: SmokeReport = {
      ok: errors.length === 0,
      version: app.getVersion(),
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        v8: process.versions.v8,
      },
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      shellReadyMs,
      readyAt,
      marks: { ...options.marks, shell: shellLoaded, rendered: shellReadyMs, ...pageMarks },
      shellUrl: window.shellContents.getURL(),
      rendererSandboxed: rendererSandboxed(window.shellContents),
      errors,
    };
    writeFileAtomicSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (!keepRunning || !report.ok) {
      app.exit(report.ok ? 0 : 1);
    }
  };
  const timeout = setTimeout(() => {
    errors.push('The shell did not load within 60 seconds');
    finish(-1, Date.now());
  }, 60_000);
  window.shellContents.once('did-fail-load', (_event, code, description) => {
    errors.push(`Shell failed to load: ${code} ${description}`);
  });
  window.shellContents.once('did-finish-load', () => {
    shellLoaded = Math.round(performance.now());
    void window.shellContents
      .executeJavaScript('document.querySelector("app-shell") !== null')
      .then((rendered: unknown) => {
        if (rendered !== true) {
          errors.push('The shell did not render');
        }
      })
      .catch((error: unknown) => errors.push(`Shell check failed: ${String(error)}`))
      .finally(() => {
        clearTimeout(timeout);
        const shellReadyMs = Math.round(performance.now());
        const readyAt = Date.now();
        // Read only now, so that reading does not delay the ready time.
        void readPageMarks(window.shellContents, options.timeOrigin).then((pageMarks) =>
          finish(shellReadyMs, readyAt, pageMarks),
        );
      });
  });
}

/**
 * Self-test of the sandbox help mode: reports that the help page loaded and quits.
 * @param contents - The help page.
 * @param reportPath - Where to write the report.
 */
export function runSandboxHelpSmokeTest(contents: WebContents, reportPath: string): void {
  contents.once('did-finish-load', () => {
    const report = {
      ok: true,
      mode: 'sandbox-help',
      version: app.getVersion(),
      packaged: app.isPackaged,
      url: contents.getURL(),
      errors: [],
    };
    writeFileAtomicSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    app.exit(0);
  });
}

function rendererSandboxed(contents: WebContents): boolean | 'unknown' {
  const pid = contents.getOSProcessId();
  if (process.platform === 'linux') {
    // A sandboxed renderer runs in its own user namespace (or under the SUID helper, where
    // the namespace link is not readable for the browser process).
    try {
      return readlinkSync(`/proc/${pid}/ns/user`) !== readlinkSync('/proc/self/ns/user');
    } catch {
      return true;
    }
  }
  const metric = app.getAppMetrics().find((m) => m.pid === pid);
  return metric?.sandboxed ?? 'unknown';
}

/**
 * Reads the shell page's own timing as marks on the clock of the other marks. The timing
 * only explains the start-up, so without an answer within 5 seconds the report goes
 * without it.
 */
async function readPageMarks(
  contents: WebContents,
  timeOrigin: number,
): Promise<Record<string, number>> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), 5_000);
  });
  try {
    const times: unknown = await Promise.race([contents.executeJavaScript(pageTimingScript), late]);
    if (typeof times !== 'object' || times === null) {
      return {};
    }
    // Both are wall-clock times, so their difference is the time since process start.
    return Object.fromEntries(
      Object.entries(times)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        .map(([name, time]) => [name, Math.round(time - timeOrigin)]),
    );
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
