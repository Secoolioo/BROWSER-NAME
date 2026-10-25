# 0009. Storage with `node:sqlite`

## Status

Accepted

## Date

2026-10-25

## Context

Astela stores history, bookmarks, the downloads list, favicons and site permissions per profile. History needs full-text search: the omnibox suggests from history in under 30 ms, and a history search over 100,000 entries must finish in under 50 ms. Updates must never destroy data, so every schema change needs a migration with a snapshot to roll back to ([ADR 0014](0014-update-architecture-with-signed-feed.md)).

Native Node modules such as `better-sqlite3` have to be rebuilt or prebuilt for every Electron ABI and every architecture, which multiplies the packaging matrix of three operating systems and two architectures and needs install-script permissions. Electron 45 contains Node 24.22, in which the built-in `node:sqlite` module is available without a flag. Its API is synchronous, which must not block the main process that drives all windows.

## Decision

Astela uses the built-in `node:sqlite` module, running in a dedicated `utilityProcess` named `data-service`.

- The `data-service` starts lazily, when the first data access happens, and communicates with the main process through a `MessagePort`. Synchronous SQLite calls block only this process.
- The profile database `profile.db` holds history, bookmarks, the downloads list, favicons and site permissions. It runs in WAL mode and uses FTS5 for full-text search.
- The schema version is kept in `PRAGMA user_version`. Migrations are classes with `from`, `to`, `up()` and `verify()`, run transactionally by the `MigrationRunner`.
- Before every migration, a snapshot is written with `VACUUM INTO`; the snapshots of the last two versions are kept.
- An older app never opens a newer, unknown schema for writing. After a rollback it restores the matching snapshot instead.
- Domain code accesses data through the `IDatabase` port and repositories such as `HistoryRepository` and `BookmarkRepository`; only the `data-service` touches SQLite directly.
- Settings, the session, themes and logs stay in plain files (JSON stores written atomically, logs as rotating JSON Lines); they do not need queries or full-text search.

**Day-one validation:** before any feature depends on the database, a validation spike confirms on Windows, macOS and Linux, each on x64 and arm64, that `node:sqlite` loads inside a `utilityProcess` of the packaged app and that FTS5, WAL and `VACUUM INTO` work.

**Fallback:** if `node:sqlite` fails that validation, a prebuilt `better-sqlite3` replaces it behind the same `IDatabase` port, recorded in a superseding ADR because it is native code. If only FTS5 is missing, full-text search falls back to FTS4.

## Consequences

Positive:

- No native module is needed, so there is no rebuild per Electron ABI and architecture and no install-script exception.
- Heavy work stays off the main thread, which protects input latency and the start-up budget ([ADR 0017](0017-performance-budgets-in-ci.md)).
- SQLite with WAL, transactions and `VACUUM INTO` gives crash-safe writes and cheap, consistent snapshots for migrations and rollback.
- Golden profiles from every released version can be migrated and verified in CI, because the data format is a single, well-defined file ([ADR 0022](0022-test-strategy.md)).

Negative:

- `node:sqlite` is much younger than established SQLite bindings, and its API may still change with a future Electron major; the `IDatabase` port limits the impact.
- The SQLite build and its compile options come with Electron, so the availability of FTS5 depends on upstream choices and needs a check on every Electron upgrade.
- Every query crosses a process boundary, which adds latency for small requests; queries are designed to return what a view needs in one round trip.

## Alternatives considered

- **`better-sqlite3`:** proven and fast, but a native module that must be built for every ABI and architecture; kept as the fallback.
- **SQLite compiled to WebAssembly (sql.js, wa-sqlite):** no native code, but slower, and persistence either rewrites the whole file or depends on browser storage APIs.
- **IndexedDB in a renderer:** no full-text search, and the data would depend on a renderer's lifetime.
- **JSON or LevelDB files:** no full-text search and no multi-table transactions.
- **SQLite in the main process:** synchronous calls would block every window.
