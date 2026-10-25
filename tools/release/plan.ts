/**
 * Decides what the release workflow does for the commit on `main`: when no published
 * release exists for the version in app/package.json, the version is released; otherwise
 * only the website is deployed. Prints `key=value` lines for `$GITHUB_OUTPUT`.
 *
 * A release needs the public update keys and the repository key in `app/build/keys/`,
 * because every package embeds them; without them the installed browser could never
 * update, so the plan fails instead. It also fails when the repository name differs from
 * brand.json, because the packages take their website and update URLs from there.
 *
 * Usage: node tools/release/plan.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { channelOf, listPublishedReleases, readBrand } from './releases.ts';

const root = resolve(import.meta.dirname, '../..');
const repository = process.env['GITHUB_REPOSITORY'] ?? readBrand().repository;
const { version } = JSON.parse(readFileSync(resolve(root, 'app/package.json'), 'utf8')) as {
  version: string;
};

const published = (await listPublishedReleases(repository)).some((r) => r.version === version);
// 0.0.0 is the version before the first release preparation.
const release = !published && version !== '0.0.0';

if (release) {
  const brand = readBrand().repository;
  if (repository.toLowerCase() !== brand.toLowerCase()) {
    throw new Error(`The repository is ${repository}, but brand.json names ${brand}`);
  }
  const keys = resolve(root, 'app/build/keys');
  const files = existsSync(keys) ? readdirSync(keys) : [];
  const missing = [
    files.some((f) => /^update-.+\.pub\.pem$/.test(f)) ? undefined : 'update-*.pub.pem',
    files.includes('linux-repo.pub.asc') ? undefined : 'linux-repo.pub.asc',
  ].filter((f) => f !== undefined);
  if (missing.length > 0) {
    throw new Error(`Releasing needs the public keys in app/build/keys: ${missing.join(', ')}`);
  }
}

console.log(`version=${version}`);
console.log(`tag=v${version}`);
console.log(`prerelease=${channelOf(version) === 'beta'}`);
console.log(`release=${release}`);
