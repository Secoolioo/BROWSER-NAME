import { readFileSync } from 'node:fs';
import type { FeedStateStore } from '../../domain/updates/feed.ts';
import { writeFileAtomicSync } from '../node/atomic-file.ts';

/** Keeps the highest feed sequence seen in a small JSON file in the profile. */
export class JsonFeedStateStore implements FeedStateStore {
  private readonly path: string;

  /** @param path - The state file. */
  constructor(path: string) {
    this.path = path;
  }

  readSequence(): number {
    try {
      const state: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (typeof state === 'object' && state !== null && 'sequence' in state) {
        return typeof state.sequence === 'number' ? state.sequence : 0;
      }
    } catch {
      // No state yet: every sequence is acceptable.
    }
    return 0;
  }

  writeSequence(sequence: number): void {
    writeFileAtomicSync(this.path, `${JSON.stringify({ sequence })}\n`);
  }
}
