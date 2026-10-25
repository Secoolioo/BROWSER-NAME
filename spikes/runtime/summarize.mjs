// Prints a compact summary of result.json as a workflow notice, readable through the API.
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const r = d.results;
const steps = r.sqlite?.data?.steps ?? {};
const summary = {
  os: `${d.platform}-${d.arch}`,
  ozone: d.ozone,
  sandboxed: d.sandboxed,
  electron: d.versions.electron,
  sqlite: r.sqlite && {
    ok: r.sqlite.data?.ok ?? false,
    error: r.sqlite.error?.slice(0, 200),
    version: steps.open?.value,
    wal: steps.wal?.value,
    insert100kMs: steps.insert100k?.ms,
    ftsP50: steps.ftsQuery?.value?.map((q) => q.p50),
    vacuumInto: steps.vacuumInto?.ok,
    failed: Object.entries(steps)
      .filter(([, s]) => !s.ok)
      .map(([k, s]) => `${k}: ${s.error}`),
  },
  reparent:
    r.reparent &&
    (r.reparent.ok
      ? (({ noReload, sameProcess, stateKept, focusedAfterMove, moveMs }) => ({
          noReload,
          sameProcess,
          stateKept,
          focusedAfterMove,
          moveMs,
        }))(r.reparent.data)
      : { error: r.reparent.error?.slice(0, 300) }),
  inventory:
    r.inventory &&
    (r.inventory.ok
      ? {
          globals: r.inventory.data.globals.length,
          secure: r.inventory.data.secureContext,
          probes: r.inventory.data.availabilityProbes,
          brands: r.inventory.data.brands?.map((b) => b.brand),
        }
      : { error: r.inventory.error?.slice(0, 300) }),
};
console.log(
  `::notice title=spike ${summary.os}${d.ozone ? ' ' + d.ozone : ''}::${JSON.stringify(summary)}`,
);
