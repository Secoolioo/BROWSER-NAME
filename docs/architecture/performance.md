# Performance

> **Status:** partly implemented. The harness checks the start-up, idle memory, idle CPU, bundle and size budgets on every pull request. See [implementation status](#implementation-status).

Performance comes first among Astela's [principles](principles.md). Budgets are measured in CI, and every regression fails the build. The decision record is ADR 0017 (performance budgets in CI); see the [decision record index](../adr/README.md).

## Baseline

These facts set the starting point (as of October 2026). Unless noted otherwise, they refer to Electron 45.0.0 with Chromium 156.0.8078.48, Node 24.22.0 and V8 15.6.

- **Package size:** Electron itself makes up about 97 % of the package size. The Electron 45 zip archives measure 123.9 MB on Linux, 158.2 MB on Windows and 120.7 MB on macOS arm64. Typical installers of real-world apps on Electron 44: NSIS 121 MB, dmg 133 MB, AppImage 129 MB, deb 100 MB, rpm 89 MB.
- **Memory:** the fixed processes (browser, GPU and network service) take about 220–250 MB resident. Every sandboxed renderer adds about 17–28 MB of private memory.
- **Startup:** spawn to `ready` takes about 149 ms (Linux, Electron 45 with its Node snapshot); spawn to the first contentful paint of an empty page takes about 286–317 ms (Apple Silicon).
- **CI runners:**
  - Linux and Windows: 4 vCPU, 16 GB.
  - macOS arm64: only 3 vCPU, 7 GB.
  - No GPU rendering, only the software path.
  - Variance is high, so measurements are taken **relative** to a bare Electron reference in the **same job**.

Most of the size and the fixed memory cost come from Electron itself. The budgets therefore limit what Astela adds on top of a bare Electron app with the same structure.

## Mandatory techniques

These techniques apply from M1:

1. **A tiny main entry point:**
   - The BootGuard, policies, settings and the window come first; everything else loads through `import()` after the first paint.
   - Nothing awaits large bundles before `ready`.
   - `Menu.setApplicationMenu` is set early.
2. **Shell UI from the `app://` scheme** with the `codeCache` privilege and `v8CacheOptions: 'bypassHeatCheck'`, served with `protocol.registerSource`, so files stream without the main thread (see ADR 0008).
3. **Bundles:** main, preload and UI are built with Vite and Rolldown. Module chunks load only when their module is active (see [modules](modules.md)).
4. **No synchronous IPC.** State patches are batched per frame. SQLite and hashing run in a `utilityProcess` (see [IPC](ipc.md) and [data](data.md)).
5. **Tab resources:**
   - Tabs are lazy and restore their history with `navigationHistory.restore()`.
   - A sleeping tab keeps its navigation entries and a thumbnail; its `webContents` is closed.
   - `backgroundThrottling` stays on.
   - Background tabs use `focusOnNavigation: false`.
6. **UI and package:**
   - UI animations use only `transform` and `opacity`, respect `prefers-reduced-motion` and run no timers while idle (see [design system](design-system.md)).
   - `electronLanguages` is limited to the shipped UI languages, English and German, which saves up to 12.8 MB compressed on Windows (as of October 2026).
   - The asar archive is unpacked as little as possible.
7. **Decided later, based on measurements:**
   - A V8 snapshot, only if it gains more than 50 ms, because it replaces the built-in Node snapshot.
   - `--process-per-site` for Astela's own UI surfaces only, never for web tabs.
   - A spare renderer for faster new tabs.

New dependencies need a stated reason. Anything larger than 20 KB gzipped in the UI, or with native code, needs a decision record (see the [maintainer workflow](../maintainers/WORKFLOW.md)).

## Budgets

The budgets are CI gates: a regression fails the build. "Bare" means the bare Electron fixture described under [measurement method](#measurement-method).

| Metric                                                               | Budget                                                                                                                                                                                                          | Type                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Warm start: spawn to interactive shell                               | ≤ bare + 120 ms **and** ≤ 1.25 × bare; ceiling 1.0 s (Linux, Windows) and 0.8 s (macOS)                                                                                                                         | relative + ceiling  |
| Spawn to first restored tab painted                                  | ≤ interactive shell + 150 ms                                                                                                                                                                                    | relative            |
| Cold start (cache dropped: `drop_caches` on Linux, `purge` on macOS) | ≤ bare + 250 ms **and** ≤ 1.5 × bare; gates on Linux and macOS. Windows reports only, because its file cache cannot be cleared reliably.                                                                        | relative            |
| Memory, idle (1 window, new tab page), after 15 s                    | Linux PSS and Windows private bytes ≤ bare + 60 MB; macOS `phys_footprint` ≤ bare + 50 MB; ceiling 350 MB PSS                                                                                                   | relative + ceiling  |
| Memory, 20 active tabs (20 local fixture origins)                    | ≤ 1.10 × bare with 20 views + 80 MB; ceiling 1.5 GB PSS                                                                                                                                                         | relative + ceiling  |
| Memory, 1 active and 19 sleeping tabs                                | ≤ idle memory + 30 MB; at least 85 % of a tab's memory released within 5 s                                                                                                                                      | relative            |
| CPU, idle for 60 s, 1 window                                         | sum of all processes ≤ 0.5 % of one core and ≤ bare + 0.2 percentage points                                                                                                                                     | absolute + relative |
| CPU, 20 static background tabs                                       | ≤ 1.0 % of one core                                                                                                                                                                                             | absolute            |
| Tab switch, live tab                                                 | p50 ≤ 33 ms, p95 ≤ 66 ms                                                                                                                                                                                        | absolute            |
| Tab switch, sleeping tab                                             | thumbnail ≤ 50 ms; content p95 ≤ 400 ms                                                                                                                                                                         | absolute            |
| Workspace switch (20 live tabs)                                      | p95 ≤ 100 ms, no new processes                                                                                                                                                                                  | absolute            |
| Installer per format                                                 | ≤ bare Electron installer of the same format, built in the same run, + 8 MB. Absolute caps are calibrated in the walking skeleton from measured bare packages and recalibrated for every Electron major.        | delta               |
| Unpacked size                                                        | ≤ bare + 25 MB                                                                                                                                                                                                  | delta               |
| UI JavaScript                                                        | start chunk ≤ 300 KB minified (about 90 KB Brotli); all UI JavaScript ≤ 1 MB; preload ≤ 20 KB; main startup path ≤ 150 KB; growth above 2 % or 10 KB per pull request needs a justification in the pull request | absolute            |

### Related targets

The M1 acceptance criteria and the settings, policy and theme design add these targets, each designed to be checked by an automated test:

- Opening and closing 100 tabs leaves memory at no more than 110 % of the starting value (no leak).
- Restoring a session with 100 tabs stays within the startup budget plus 150 ms; only visible tabs load.
- Full-text history search answers in less than 50 ms with 100,000 entries.
- Address bar suggestions from history, bookmarks and open tabs appear in less than 30 ms.
- A change in the theme editor is visible in less than 100 ms; switching a workspace theme is a token swap within one frame.
- Reading policies before `app.whenReady()` takes no more than 60 ms (see [settings, policies and themes](settings-policy-theme.md)).

## Measurement method

### Bare fixture

The reference is a bare Electron app with:

- the same Electron version,
- the same fuses and flags,
- the same topology: a `BaseWindow` with a UI view and N tab views,
- the same local fixture pages.

### Procedure

- One job runs **three** variants in alternation: the pull request build, the `main` build (the artifact of the last green `main` run) and the bare fixture. Results are never compared across runs on shared runners.
- **Timing:** n = 20, with median and p90. A metric fails only when a Mann-Whitney U test gives p < 0.01 **and** the effect exceeds the threshold.
- **Memory:** n = 10, with the threshold rule applied to the median, because PSS varies little.
- One automatic rerun happens before a check fails.
- The first start after an update is excluded from the gates and reported separately.

### Memory metrics

- Linux: the sum of `Pss` from `/proc/<pid>/smaps_rollup` across all processes (gating).
- Windows: `privateBytes`.
- macOS: `phys_footprint`.
- RSS is never summed, because shared pages would be counted once per process.

### CPU

CPU load is the change in `cumulativeCPUUsage` over 60 seconds.

### Startup marks

The harness will record these marks:

1. spawn,
2. first main-process JavaScript,
3. `ready`,
4. window visible,
5. first contentful paint of the shell and the interactive mark,
6. first tab painted.

### History without commits

Measurement history is never committed to the repository:

- Every CI run will keep its results as a workflow artifact.
- Every release will carry a `perf.json` asset.
- The website will show the real measurements under `/features/performance`.

### Runner variance

An A/A run once a week compares identical builds. It measures the runner variance and calibrates the thresholds.

The performance harness is designed to run on every pull request on all three operating systems; on macOS, the limited runners allow only relative values. See [testing](testing.md) for the overall test strategy.

## Implementation status

The harness (`tools/perf/run.ts`) runs in the `perf` job of every pull request on `ubuntu-24.04`, `windows-2025` and `macos-15` and fails the build when a budget is exceeded. It checks:

- **Warm start:** n = 20 after two warm-up rounds, median against the bare reference and the ceiling. A median over the budget fails only when a one-sided Mann-Whitney U test (`tools/perf/stats.ts`) shows that the browser's times are significantly larger than the reference times plus the allowed difference (p < 0.01); the job summary shows the p-value. On the 3-core macOS runners the difference to the reference varied between 73 and 152 ms across identical builds, so a median alone was not a reliable gate. Each variant keeps its profile between runs and quits normally, as in real use. The interactive mark is the self-test report, written once the shell has loaded and rendered; the report also carries the marks `main`, `policies`, `ready`, `window`, `settings`, `shell` and `rendered` in milliseconds since process start, and the job summary shows their medians next to those of the reference.
- **Memory, idle:** n = 10 after 15 s, median, with the metric per operating system above. On Linux, the harness reads the memory maps of sandboxed processes through `sudo`.
- **CPU, idle:** one 60-second window per variant, after 15 s.
- **UI JavaScript, preloads and the main start-up path:** sizes of the built bundles.
- **Unpacked size:** the unpacked package against the Electron distribution.

The bare reference (`app/tests/perf/bare/`) runs in a copy of the Electron distribution as its app folder, with the fuses of a shipped package except the two asar fuses. Each group of measurements that fails is measured once more before the job fails. Results are kept as the `perf-<os>` workflow artifact.

Not implemented yet: the comparison with the `main` build, the cold start, the tab, workspace and 20-tab budgets, the installer budgets, the first-tab-painted mark, the weekly A/A run and the `perf.json` release asset.
