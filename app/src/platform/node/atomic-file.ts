import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { open, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes a file so that readers see either the old or the new content, never a partial
 * file: the data goes to a temporary file, is flushed to disk and then renamed over the
 * target.
 * @param path - Target file.
 * @param data - New content.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
}

/**
 * Synchronous variant of {@link writeFileAtomic}, for shutdown and startup paths.
 * @param path - Target file.
 * @param data - New content.
 */
export function writeFileAtomicSync(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, 'w');
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data) : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}
