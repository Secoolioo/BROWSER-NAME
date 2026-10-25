/**
 * Reads memory and CPU time of a process tree on Windows, macOS and Linux, and starts and
 * stops process trees. The numbers follow the performance method in
 * docs/architecture/performance.md: Linux PSS, Windows private bytes and macOS physical
 * footprint, never summed RSS.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

/** One process of a sample. */
interface ProcessInfo {
  readonly pid: number;
  readonly ppid: number;
  /** User and kernel CPU time in milliseconds. */
  readonly cpuMs: number;
  /** Memory in bytes, when the platform reports it for all processes at once. */
  readonly memoryBytes?: number;
}

/** Totals for a process and all its descendants. */
export interface TreeSample {
  readonly processes: number;
  readonly cpuMs: number;
  readonly memoryBytes: number;
}

/** Name of the memory metric on this platform. */
export const memoryMetric =
  process.platform === 'linux'
    ? 'PSS'
    : process.platform === 'win32'
      ? 'private bytes'
      : 'physical footprint';

/**
 * Starts a program in its own process group, so the whole tree can be stopped.
 * @param command - Program.
 * @param args - Arguments.
 */
export function startTree(command: string, args: readonly string[]): ChildProcess {
  return spawn(command, args, {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
}

/**
 * Stops a process tree started with {@link startTree} and waits until its root exited.
 * @param child - The root process.
 */
export async function stopTree(child: ChildProcess): Promise<void> {
  const exited = new Promise<void>((done) => {
    if (child.exitCode !== null || child.signalCode !== null) done();
    else child.once('exit', () => done());
  });
  if (child.pid !== undefined) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The group is already gone.
      }
    }
  }
  await exited;
}

/**
 * Sums CPU time and memory over a process and all its descendants.
 * @param rootPid - The root process.
 */
export function sampleTree(rootPid: number): TreeSample {
  const all = listProcesses();
  const children = new Map<number, ProcessInfo[]>();
  for (const info of all.values()) {
    const list = children.get(info.ppid) ?? [];
    list.push(info);
    children.set(info.ppid, list);
  }
  const tree: ProcessInfo[] = [];
  const root = all.get(rootPid);
  const queue = root === undefined ? [] : [root];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || tree.includes(next)) continue;
    tree.push(next);
    queue.push(...(children.get(next.pid) ?? []));
  }
  const memory =
    process.platform === 'linux'
      ? linuxPss(tree.map((p) => p.pid))
      : tree.reduce((sum, p) => sum + (p.memoryBytes ?? 0), 0);
  return {
    processes: tree.length,
    cpuMs: tree.reduce((sum, p) => sum + p.cpuMs, 0),
    memoryBytes: memory,
  };
}

function listProcesses(): Map<number, ProcessInfo> {
  if (process.platform === 'linux') return linuxProcesses();
  if (process.platform === 'win32') return windowsProcesses();
  return macProcesses();
}

let clockTicks: number | undefined;

function linuxProcesses(): Map<number, ProcessInfo> {
  clockTicks ??=
    Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim()) || 100;
  const result = new Map<number, ProcessInfo>();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${name}/stat`, 'utf8');
    } catch {
      continue;
    }
    // The command name can contain spaces and parentheses; the fields follow the last ')'.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ppid = Number(fields[1]);
    const ticks = Number(fields[11]) + Number(fields[12]);
    result.set(Number(name), { pid: Number(name), ppid, cpuMs: (ticks * 1000) / clockTicks });
  }
  return result;
}

function linuxPss(pids: readonly number[]): number {
  const files = pids.map((pid) => `/proc/${pid}/smaps_rollup`);
  let text = '';
  const unreadable: string[] = [];
  for (const file of files) {
    try {
      text += readFileSync(file, 'utf8');
    } catch {
      unreadable.push(file);
    }
  }
  if (unreadable.length > 0) {
    // Sandboxed processes are not dumpable, so only root can read their memory maps.
    const viaSudo = spawnSync('sudo', ['-n', 'cat', ...unreadable], { encoding: 'utf8' });
    text += viaSudo.stdout;
  }
  let kib = 0;
  for (const match of text.matchAll(/^Pss:\s+(\d+) kB$/gm)) {
    kib += Number(match[1]);
  }
  return kib * 1024;
}

function windowsProcesses(): Map<number, ProcessInfo> {
  const script =
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) ' +
    '$($_.PrivatePageCount) $($_.KernelModeTime) $($_.UserModeTime)" }';
  const output = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout;
  const result = new Map<number, ProcessInfo>();
  for (const line of output.split(/\r?\n/)) {
    const [pid, ppid, privateBytes, kernel, user] = line.trim().split(' ').map(Number);
    if (pid === undefined || Number.isNaN(pid) || ppid === undefined) continue;
    result.set(pid, {
      pid,
      ppid,
      // Kernel and user times are counted in units of 100 ns.
      cpuMs: ((kernel ?? 0) + (user ?? 0)) / 10_000,
      memoryBytes: privateBytes ?? 0,
    });
  }
  return result;
}

function macProcesses(): Map<number, ProcessInfo> {
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,time='], { encoding: 'utf8' }).stdout;
  // The MEM column of top is the physical footprint.
  const top = spawnSync('top', ['-l', '1', '-stats', 'pid,mem'], { encoding: 'utf8' }).stdout;
  const footprint = new Map<number, number>();
  const units: Readonly<Record<string, number>> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  for (const match of top.matchAll(/^\s*(\d+)\s+([\d.]+)([BKMG])[+-]?\s*$/gm)) {
    footprint.set(Number(match[1]), Number(match[2]) * (units[match[3] ?? 'B'] ?? 1));
  }
  const result = new Map<number, ProcessInfo>();
  for (const line of ps.split('\n')) {
    const [pid, ppid, time] = line.trim().split(/\s+/);
    if (pid === undefined || ppid === undefined || time === undefined) continue;
    const memory = footprint.get(Number(pid));
    result.set(Number(pid), {
      pid: Number(pid),
      ppid: Number(ppid),
      cpuMs: parseCpuTime(time),
      ...(memory === undefined ? {} : { memoryBytes: memory }),
    });
  }
  return result;
}

/**
 * Parses the `time` column of `ps`, such as `1:02.34` or `1-02:03:04.56`.
 * @param value - The column value.
 */
function parseCpuTime(value: string): number {
  const [days, rest] = value.includes('-') ? value.split('-') : ['0', value];
  const parts = (rest ?? '').split(':').map(Number).toReversed();
  const seconds = (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600;
  return (seconds + Number(days) * 86_400) * 1000;
}
