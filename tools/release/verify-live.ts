/**
 * Checks the deployed website the way installed browsers and package managers see it:
 *
 * - the update index and every release manifest carry a valid signature of one of the
 *   public update keys, and the index is valid for at least another week;
 * - every artifact of every manifest can be downloaded and has the size the manifest names;
 * - the APT `InRelease` files and the DNF `repomd.xml` are signed with the repository key.
 *
 * Prints `stable=<version>` and `beta=<version>` (the newest release of each channel, empty
 * when there is none) for `$GITHUB_OUTPUT`, so a later step can install them from the live
 * repositories.
 *
 * Pages needs a moment until a new deployment is served everywhere; with `--min-sequence`,
 * the check waits up to ten minutes for an index with at least that sequence.
 *
 * Usage: node tools/release/verify-live.ts [--site <url>] [--min-sequence <n>]
 */
import { spawnSync } from 'node:child_process';
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compareVersions, readBrand } from './releases.ts';

interface Index {
  readonly sequence: number;
  readonly expiresAt: string;
  readonly releases: readonly { version: string; channel: 'stable' | 'beta' }[];
}

interface Manifest {
  readonly version: string;
  readonly downloadBase: string;
  readonly artifacts: Record<string, { file: string; size: number }>;
}

const keys = resolve(import.meta.dirname, '../../app/build/keys');
const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const minSequence = Number(argument('min-sequence') ?? '0');
const site = new URL(argument('site') ?? readBrand().website);
if (!site.pathname.endsWith('/')) site.pathname += '/';
const updateKeys: KeyObject[] = readdirSync(keys)
  .filter((name) => /^update-.+\.pub\.pem$/.test(name))
  .map((name) => createPublicKey(readFileSync(join(keys, name))));
if (updateKeys.length === 0) throw new Error('No public update keys in app/build/keys');
const failures: string[] = [];

async function fetchOk(path: string): Promise<Buffer> {
  // A unique query bypasses cached copies of an earlier deployment.
  const url = new URL(path, site);
  url.searchParams.set('check', String(Date.now()));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Fetches a JSON file and its `.sig` and returns the value if one key verifies it. */
async function signedJson<T>(path: string): Promise<T> {
  const [text, signature] = await Promise.all([fetchOk(path), fetchOk(`${path}.sig`)]);
  const raw = Buffer.from(signature.toString('utf8').trim(), 'base64');
  if (!updateKeys.some((key) => verify(null, text, key, raw))) {
    throw new Error(`${path}: the signature does not verify`);
  }
  return JSON.parse(text.toString('utf8')) as T;
}

/** Downloads the first byte of a file and returns its total size. */
async function remoteSize(url: string): Promise<number | undefined> {
  const response = await fetch(url, { headers: { range: 'bytes=0-0' } });
  await response.body?.cancel();
  if (response.status !== 206) return undefined;
  return Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1]);
}

let index = await signedJson<Index>('updates/v1/index.json');
for (let attempt = 1; index.sequence < minSequence; attempt += 1) {
  if (attempt > 20) throw new Error(`The live index still has sequence ${index.sequence}`);
  console.log(`Waiting for the new deployment (sequence ${index.sequence} < ${minSequence})`);
  await new Promise((done) => setTimeout(done, 30_000));
  index = await signedJson<Index>('updates/v1/index.json');
}
const validFor = Date.parse(index.expiresAt) - Date.now();
if (validFor < 7 * 86_400_000) failures.push(`The index expires too soon: ${index.expiresAt}`);
for (const { version } of index.releases) {
  const manifest = await signedJson<Manifest>(`updates/v1/releases/${version}.json`);
  if (manifest.version !== version) failures.push(`The manifest of ${version} is for another version`);
  for (const [key, artifact] of Object.entries(manifest.artifacts)) {
    const size = await remoteSize(new URL(artifact.file, manifest.downloadBase).href);
    if (size !== artifact.size) {
      failures.push(`${version} ${key}: expected ${artifact.size} bytes, got ${String(size)}`);
    }
  }
  console.log(`ok    ${version}: signed manifest, ${Object.keys(manifest.artifacts).length} downloads`);
}

const newest = (channel: 'stable' | 'beta'): string =>
  index.releases
    .filter((r) => channel === 'beta' || r.channel === 'stable')
    .map((r) => r.version)
    .toSorted(compareVersions)
    .at(-1) ?? '';

// The package repositories: signatures by the repository key.
const gnupg = mkdtempSync(join(tmpdir(), 'verify-live-'));
try {
  const gpg = (args: readonly string[]): boolean =>
    spawnSync('gpg', ['--homedir', gnupg, '--batch', ...args], { stdio: 'ignore' }).status === 0;
  if (!gpg(['--import', join(keys, 'linux-repo.pub.asc')])) {
    throw new Error('The repository key could not be imported');
  }
  const signed: [string, string | undefined][] = [];
  for (const channel of ['stable', 'beta'] as const) {
    if (newest(channel) === '') continue;
    signed.push([`apt/dists/${channel}/InRelease`, undefined]);
    signed.push([`rpm/${channel}/repodata/repomd.xml`, `rpm/${channel}/repodata/repomd.xml.asc`]);
  }
  for (const [path, signature] of signed) {
    const file = join(gnupg, 'file');
    writeFileSync(file, await fetchOk(path));
    const args = ['--verify'];
    if (signature !== undefined) {
      writeFileSync(`${file}.asc`, await fetchOk(signature));
      args.push(`${file}.asc`);
    }
    if (gpg([...args, file])) console.log(`ok    ${path}: signed`);
    else failures.push(`${path}: the signature does not verify`);
  }
} finally {
  rmSync(gnupg, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exit(1);
}
console.log(`stable=${newest('stable')}`);
console.log(`beta=${newest('beta')}`);
