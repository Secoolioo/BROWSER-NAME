import { readFileSync } from 'node:fs';
import type { BootState, BootStateStore } from '../../domain/updates/boot-guard.ts';
import { writeFileAtomicSync } from '../node/atomic-file.ts';

/** Keeps the boot state in `boot-state.json`, written atomically. */
export class JsonBootStateStore implements BootStateStore {
  private readonly path: string;

  /** @param path - The state file. */
  constructor(path: string) {
    this.path = path;
  }

  read(): BootState {
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      return isBootState(value) ? value : { blocked: [] };
    } catch {
      return { blocked: [] };
    }
  }

  write(state: BootState): void {
    writeFileAtomicSync(this.path, `${JSON.stringify(state)}\n`);
  }
}

function isBootState(value: unknown): value is BootState {
  if (typeof value !== 'object' || value === null || !('blocked' in value)) return false;
  if (!Array.isArray(value.blocked) || !value.blocked.every((v) => typeof v === 'string')) {
    return false;
  }
  if (!('pending' in value) || value.pending === undefined) return true;
  const pending: unknown = value.pending;
  return (
    typeof pending === 'object' &&
    pending !== null &&
    'version' in pending &&
    typeof pending.version === 'string' &&
    'previous' in pending &&
    typeof pending.previous === 'string' &&
    'attempts' in pending &&
    typeof pending.attempts === 'number'
  );
}
