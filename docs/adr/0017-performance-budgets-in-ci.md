# 0017. Performance budgets in CI

## Status

Accepted

## Date

2026-10-25

## Context

Performance comes first in Lampo's [principles](../architecture/principles.md), and only measured numbers count. Most of the cost is fixed by Electron itself: it accounts for about 97 % of the package size (Electron 45 zip: Linux 123.9 MB, Windows 158.2 MB, macOS arm64 120.7 MB). The browser, GPU and network processes together take about 220–250 MB resident, and each sandboxed renderer adds about 17–28 MB of private memory. Spawn to `ready` takes about 149 ms on Linux with Electron 45 and its Node snapshot.

The CI runners are shared and noisy. Linux and Windows runners have 4 vCPUs and 16 GB, macOS arm64 runners only 3 vCPUs and 7 GB, and none renders on a GPU. Absolute timings on such machines vary too much to gate on, and comparisons across runs land on different hosts.

## Decision

Performance budgets are CI gates: a regression fails the build. Lampo measures what it adds on top of Electron, relative to a bare Electron reference in the same job, with absolute ceilings where they are meaningful.

| Metric                                                    | Budget                                                                                                                     | Type                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Warm start, spawn to interactive shell                    | ≤ bare + 120 ms and ≤ 1.25 × bare; ceiling 1.0 s on Linux and Windows, 0.8 s on macOS                                      | relative + ceiling  |
| Spawn to first restored tab painted                       | ≤ interactive shell + 150 ms                                                                                               | relative            |
| Cold start (caches dropped with `drop_caches` or `purge`) | ≤ bare + 250 ms and ≤ 1.5 × bare; gates on Linux and macOS, report only on Windows                                         | relative            |
| Idle memory (one window, new tab page, after 15 s)        | Linux PSS and Windows private bytes ≤ bare + 60 MB, macOS `phys_footprint` ≤ bare + 50 MB; ceiling 350 MB PSS              | relative + ceiling  |
| Memory with 20 active tabs on 20 local fixture origins    | ≤ 1.10 × bare with 20 views + 80 MB; ceiling 1.5 GB PSS                                                                    | relative + ceiling  |
| Memory with 1 active and 19 sleeping tabs                 | ≤ idle memory + 30 MB; at least 85 % of a tab's memory released within 5 s                                                 | relative            |
| Idle CPU over 60 s, one window                            | all processes together ≤ 0.5 % of one core and ≤ bare + 0.2 percentage points                                              | absolute + relative |
| CPU with 20 static background tabs                        | ≤ 1.0 % of one core                                                                                                        | absolute            |
| Switch to a live tab                                      | p50 ≤ 33 ms, p95 ≤ 66 ms                                                                                                   | absolute            |
| Switch to a sleeping tab                                  | thumbnail ≤ 50 ms; content p95 ≤ 400 ms                                                                                    | absolute            |
| Workspace switch with 20 live tabs                        | p95 ≤ 100 ms, no new processes                                                                                             | absolute            |
| Installer per format                                      | ≤ bare Electron installer of the same format, built in the same run, + 8 MB                                                | delta               |
| Unpacked size                                             | ≤ bare + 25 MB                                                                                                             | delta               |
| JavaScript size                                           | UI start chunk ≤ 300 KB minified (about 90 KB Brotli), all UI JavaScript ≤ 1 MB, preload ≤ 20 KB, main start path ≤ 150 KB | absolute            |

Absolute installer ceilings are set from measured bare packages in the walking skeleton and recalibrated for every Electron major. A pull request that grows bundles by more than 2 % or 10 KB states the reason in its description.

How the harness measures:

- **Bare fixture:** the same Electron version, fuses and flags, the same topology (`BaseWindow`, one UI view and N tab views) and the same local fixture pages.
- **Three variants in one job:** the pull request build, the `main` build (artifact of the last green `main` run) and the bare fixture run alternately on the same runner. There are no comparisons across runs.
- **Statistics:** timings use n = 20 with median and p90 and fail only when a Mann-Whitney U test gives p < 0.01 and the effect exceeds the threshold. Memory uses n = 10 with the threshold applied to the median. One automatic re-run happens before a failure is reported.
- **Metrics:** on Linux the sum of `Pss` from `/proc/<pid>/smaps_rollup` gates; Windows uses private bytes and macOS `phys_footprint`. RSS is never summed. CPU is the change of `cumulativeCPUUsage` over 60 s.
- **Start marks:** spawn, first main-process JavaScript, `ready`, window visible, shell first contentful paint and interactive mark, first tab painted. The first start after an update is excluded from the gates and reported separately.
- **History without commits:** results are workflow artifacts, every release carries a `perf.json` asset, and the website shows the real numbers under `/features/performance` ([ADR 0020](0020-documentation-site-and-api-docs.md)).
- **Calibration:** a weekly A/A run measures runner variance and adjusts the thresholds.
- **Runners:** `ubuntu-24.04`, `windows-2025` and `macos-15`; on macOS only the relative budgets and the 0.8 s warm-start ceiling gate.

The techniques that keep Lampo within these budgets, such as a tiny main entry, lazily loaded modules and no synchronous IPC, are described in [performance](../architecture/performance.md).

## Consequences

Positive:

- Regressions are expected to surface in the pull request that causes them, not after a release.
- Relative measurement in one job cancels most runner noise and makes Electron upgrades neutral to the gates.
- Budgets target the part Lampo controls rather than Electron's fixed cost.
- Performance claims on the website are CI measurements.

Negative:

- Performance jobs on three operating systems add CI time, and macOS jobs are limited in parallelism on free runners.
- Statistical gates can still be flaky; the re-run and the A/A calibration reduce this, and remaining flakes are fixed with priority because tests are never quarantined.
- The bare fixture has to be kept in step with the app's window and view topology.
- Cold start on Windows is reported but not gated, and GPU-specific regressions are not caught because runners render in software.

## Alternatives considered

- **Absolute budgets only:** shared runners vary too much, so thresholds would be either meaningless or flaky.
- **Comparison with stored results from earlier runs:** different hosts make the data noisy, and keeping history in the repository would need bot commits ([ADR 0016](0016-release-pipeline-without-bot-commits.md)).
- **Dedicated benchmark machines:** cost money and maintenance, and would still need relative checks per operating system.
- **Lighthouse or other page-level metrics:** do not cover main-process start-up, multi-process memory or package size.
- **Manual benchmarks before releases:** catch regressions too late and are not reproducible.
