// Utility process: checks node:sqlite with WAL, FTS5 and VACUUM INTO.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = mkdtempSync(join(process.argv[2], 'sqlite-spike-'));
const result = { steps: {} };
const step = (name, fn) => {
  const t0 = performance.now();
  try {
    const value = fn();
    result.steps[name] = { ok: true, ms: Math.round((performance.now() - t0) * 100) / 100, value };
  } catch (error) {
    result.steps[name] = { ok: false, error: String(error?.message ?? error) };
  }
};

const words = ['alpha', 'browser', 'workspace', 'theme', 'policy', 'update', 'kernel', 'session'];
let db;
step('open', () => {
  db = new DatabaseSync(join(dir, 'profile.db'));
  return db.prepare('select sqlite_version() as v').get().v;
});
step('wal', () => db.prepare('pragma journal_mode = wal').get().journal_mode);
step('compileOptions', () =>
  db
    .prepare('pragma compile_options')
    .all()
    .map((r) => r.compile_options)
    .filter((o) => /FTS|JSON|RTREE|MATH/.test(o)),
);
step('fts5Create', () => {
  db.exec(`create table history (id integer primary key, url text, title text, visited integer);
create virtual table history_fts using fts5(title, url, content='history', content_rowid='id');`);
  return true;
});
step('insert100k', () => {
  const insert = db.prepare('insert into history (url, title, visited) values (?, ?, ?)');
  const fts = db.prepare('insert into history_fts (rowid, title, url) values (?, ?, ?)');
  db.exec('begin');
  for (let i = 0; i < 100_000; i++) {
    const title = `${words[i % 8]} ${words[(i * 7) % 8]} page ${i}`;
    const url = `https://example.test/${words[(i * 3) % 8]}/${i}`;
    const { lastInsertRowid } = insert.run(url, title, Date.now() - i * 1000);
    fts.run(lastInsertRowid, title, url);
  }
  db.exec('commit');
  return 100_000;
});
step('ftsQuery', () => {
  const q = db.prepare(
    `select h.id, h.title from history_fts f join history h on h.id = f.rowid
     where history_fts match ? order by rank limit 20`,
  );
  const run = (term) => {
    const times = [];
    let rows = 0;
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      rows = q.all(term).length;
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { term, rows, p50: +times[10].toFixed(2), max: +times[19].toFixed(2) };
  };
  // 12,500 matching rows ranked, then a prefix query over all titles.
  return [run('workspace kernel'), run('brow*')];
});
step('vacuumInto', () => {
  const snap = join(dir, 'profile.snapshot.db');
  db.exec(`vacuum into '${snap.replaceAll("'", "''")}'`);
  const copy = new DatabaseSync(snap, { readOnly: true });
  const n = copy.prepare('select count(*) as n from history').get().n;
  copy.close();
  return { rows: n, bytes: statSync(snap).size };
});
step('userVersion', () => {
  db.exec('pragma user_version = 3');
  return db.prepare('pragma user_version').get().user_version;
});
db?.close();
rmSync(dir, { recursive: true, force: true });
result.ok = Object.values(result.steps).every((s) => s.ok);
process.parentPort.postMessage(result);
