/**
 * Collects what the Pages deployment publishes from the GitHub releases:
 *
 * - `<out>/releases.json`: every published release with its assets and their SHA-256 from
 *   `SHA256SUMS`, oldest first. The website builds its download page from it.
 * - `<out>/manifests/<version>.json`: the update manifest of each release, which the
 *   feed tool signs into the update feed.
 * - `<out>/packages/<version>/`: the deb and rpm files of the releases that the package
 *   repositories list (the last two stable releases and the last two of any kind), and
 *   `<out>/linux-releases.txt` with one `<version>:<channel>:<dir>` line for each.
 * - `<out>/screenshots/<version>/` for the same releases and `<out>/screenshots/latest/` for
 *   the newest one: the screenshots that the release workflow took of the browser.
 *
 * Usage: node tools/release/collect.ts --out <dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  download,
  listPublishedReleases,
  readBrand,
  type PublishedRelease,
  type ReleaseAsset,
} from './releases.ts';

const outIndex = process.argv.indexOf('--out');
const out = resolve(process.argv[outIndex + 1] ?? 'releases');
if (outIndex === -1) throw new Error('Usage: node tools/release/collect.ts --out <dir>');
const repository = process.env['GITHUB_REPOSITORY'] ?? readBrand().repository;
const kept = 2;

const asset = (release: PublishedRelease, name: string): string | undefined =>
  release.assets.find((a) => a.name === name)?.url;

const releases = await listPublishedReleases(repository);
mkdirSync(join(out, 'manifests'), { recursive: true });
const summary = [];
for (const release of releases) {
  const manifest = asset(release, 'update-manifest.json');
  if (manifest === undefined) throw new Error(`v${release.version} has no update-manifest.json`);
  writeFileSync(join(out, 'manifests', `${release.version}.json`), await download(manifest));
  const sums = asset(release, 'SHA256SUMS');
  const sha256 = new Map(
    sums === undefined
      ? []
      : (await download(sums))
          .toString('utf8')
          .split('\n')
          .map((line) => /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim()))
          .filter((m) => m !== null)
          .map((m) => [m[2] ?? '', m[1] ?? '']),
  );
  summary.push({
    ...release,
    assets: release.assets.map((a) => Object.assign({ sha256: sha256.get(a.name) }, a)),
  });
}
writeFileSync(join(out, 'releases.json'), `${JSON.stringify({ repository, releases: summary }, null, 2)}\n`);

// The package repositories list the newest two stable releases and the newest two of any kind.
const listed = new Set([
  ...releases.filter((r) => r.channel === 'stable').slice(-kept),
  ...releases.slice(-kept),
]);
const lines = [];
for (const release of releases.filter((r) => listed.has(r))) {
  const dir = join(out, 'packages', release.version);
  mkdirSync(dir, { recursive: true });
  for (const file of release.assets.filter((a) => /\.(deb|rpm)$/.test(a.name))) {
    writeFileSync(join(dir, file.name), await download(file.url));
  }
  lines.push(`${release.version}:${release.channel}:${dir}`);
}
const screenshots = (release: PublishedRelease): ReleaseAsset[] =>
  release.assets.filter((a) => /^screenshot-[a-z]+\.png$/.test(a.name));
const newest = releases.at(-1);
for (const [folder, release] of [
  ...[...listed].map((r): [string, PublishedRelease] => [r.version, r]),
  ...(newest === undefined ? [] : [['latest', newest] as [string, PublishedRelease]]),
]) {
  mkdirSync(join(out, 'screenshots', folder), { recursive: true });
  for (const file of screenshots(release)) {
    writeFileSync(join(out, 'screenshots', folder, file.name), await download(file.url));
  }
}
writeFileSync(join(out, 'linux-releases.txt'), lines.map((l) => `${l}\n`).join(''));
console.log(`Collected ${releases.length} release(s); ${lines.length} for the package repositories`);
