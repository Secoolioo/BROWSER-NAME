/**
 * Reads the published releases of the repository from the GitHub REST API. The release and
 * Pages workflows use it to decide what to build and what the website, the update feed and
 * the package repositories list.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A downloadable file of a release. */
export interface ReleaseAsset {
  readonly name: string;
  readonly size: number;
  /** Public download URL. */
  readonly url: string;
}

/** A published (not draft) release. */
export interface PublishedRelease {
  readonly version: string;
  readonly channel: 'stable' | 'beta';
  readonly publishedAt: string;
  /** Web page of the release. */
  readonly page: string;
  readonly assets: readonly ReleaseAsset[];
}

interface ApiRelease {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly published_at: string | null;
  readonly html_url: string;
  readonly assets: readonly { name: string; size: number; browser_download_url: string }[];
}

/** Product identifiers from brand.json. */
export function readBrand(): {
  slug: string;
  productName: string;
  repository: string;
  website: string;
} {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, '../../brand.json'), 'utf8')) as {
    slug: string;
    productName: string;
    repository: string;
    website: string;
  };
}

/** The channel of a version: prereleases go to beta. */
export function channelOf(version: string): 'stable' | 'beta' {
  return version.includes('-') ? 'beta' : 'stable';
}

/** Splits a version into its numeric core and its prerelease identifiers. */
function splitVersion(version: string): [number[], string[]] {
  const [core = '', pre] = version.split(/-(.*)/s);
  return [core.split('.').map(Number), pre === undefined ? [] : pre.split('.')];
}

/**
 * Compares two versions of the form `X.Y.Z` or `X.Y.Z-label.N` by SemVer precedence.
 * @returns A negative number, zero or a positive number.
 */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (coreA[i] ?? 0) - (coreB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (preA.length === 0 || preB.length === 0) return preB.length - preA.length;
  for (let i = 0; i < Math.max(preA.length, preB.length); i += 1) {
    const x = preA[i];
    const y = preB[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    const diff = numeric ? Number(x) - Number(y) : x.localeCompare(y);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Calls the GitHub REST API with the workflow token when one is set.
 * @param path - API path, such as `/repos/o/r/releases`.
 */
export async function github(path: string): Promise<Response> {
  const token = process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN'];
  return fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` }),
    },
  });
}

/**
 * Lists the published releases with a `v` tag, oldest version first.
 * @param repository - `owner/name`.
 */
export async function listPublishedReleases(repository: string): Promise<PublishedRelease[]> {
  const releases: PublishedRelease[] = [];
  for (let page = 1; ; page += 1) {
    const response = await github(`/repos/${repository}/releases?per_page=100&page=${page}`);
    if (!response.ok) throw new Error(`Listing releases failed: ${response.status}`);
    const batch = (await response.json()) as ApiRelease[];
    for (const release of batch) {
      if (release.draft || release.published_at === null || !/^v\d/.test(release.tag_name)) {
        continue;
      }
      const version = release.tag_name.slice(1);
      releases.push({
        version,
        channel: channelOf(version),
        publishedAt: release.published_at,
        page: release.html_url,
        assets: release.assets.map((a) => ({
          name: a.name,
          size: a.size,
          url: a.browser_download_url,
        })),
      });
    }
    if (batch.length < 100) break;
  }
  return releases.toSorted((a, b) => compareVersions(a.version, b.version));
}

/**
 * Downloads a file and fails on any status other than 200.
 * @param url - File URL; redirects are followed.
 */
export async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Downloading ${url} failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
