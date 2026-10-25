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
  /** Milliseconds since process start at each start-up step. */
  readonly marks: Readonly<Record<string, number>>;
  readonly shellUrl: string;
  /** Whether renderer processes run inside the Chromium sandbox. */
  readonly rendererSandboxed: boolean | 'unknown';
  readonly errors: readonly string[];
}

/**
 * Runs the self-test of a packaged build: waits for the first window's shell and tab,
 * writes a JSON report and quits. Installers and CI use it to check every package; the
 * performance harness keeps the browser running to measure it.
 * @param window - The first window.
 * @param reportPath - Where to write the report.
 * @param options - Whether the browser stays open after the report, and the start-up marks
 *   so far.
 */
export function runSmokeTest(
  window: BrowserWindowController,
  reportPath: string,
  options: { readonly keepRunning: boolean; readonly marks: Readonly<Record<string, number>> },
): void {
  const { keepRunning } = options;
  let shellLoaded = -1;
  const errors: string[] = [];
  const finish = (shellReadyMs: number): void => {
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
      readyAt: Date.now(),
      marks: { ...options.marks, shell: shellLoaded, rendered: shellReadyMs },
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
    finish(-1);
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
        finish(Math.round(performance.now()));
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
