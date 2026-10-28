// Release data for the download page and the download button. The Pages workflow writes
// src/data/releases.json from the published GitHub releases (tools/release/collect.ts);
// without it, as in pull requests and local builds, there is nothing to download.

/** A file of a release, with its SHA-256 from `SHA256SUMS`. */
export interface Asset {
  readonly name: string;
  readonly size: number;
  readonly url: string;
  readonly sha256?: string;
}

/** A published release. */
export interface Release {
  readonly version: string;
  readonly channel: 'stable' | 'beta';
  readonly publishedAt: string;
  readonly page: string;
  readonly assets: readonly Asset[];
}

/** An installable package, recognized from its versionless asset name. */
export interface Package extends Asset {
  readonly os: 'windows' | 'macos' | 'linux';
  readonly arch: 'x64' | 'arm64';
  readonly format: string;
  /** What the format is for, shown next to the file. */
  readonly note: string;
}

const data = Object.values(
  import.meta.glob<{ releases: Release[] }>('../data/releases.json', {
    eager: true,
    import: 'default',
  }),
)[0];

/** Every published release, oldest first. */
export const releases: readonly Release[] = data?.releases ?? [];

/** The newest stable release, and the newest beta when it is newer than that. */
export function currentReleases(): { stable?: Release; beta?: Release } {
  const stable = releases.findLast((r) => r.channel === 'stable');
  const newest = releases.at(-1);
  return {
    ...(stable === undefined ? {} : { stable }),
    ...(newest !== undefined && newest.channel === 'beta' ? { beta: newest } : {}),
  };
}

const operatingSystems = ['windows', 'macos', 'linux'] as const;

const formats: Record<string, { format: string; note: string }> = {
  'setup.exe': { format: 'Installer (.exe)', note: 'Per user, updates itself' },
  msi: { format: 'MSI', note: 'Per machine, for managed deployment' },
  dmg: { format: 'Disk image (.dmg)', note: 'Drag to Applications, updates itself' },
  AppImage: { format: 'AppImage', note: 'Runs from anywhere, updates itself' },
  deb: { format: 'Debian package (.deb)', note: 'Adds the APT repository for updates' },
  rpm: { format: 'RPM package', note: 'Adds the DNF repository for updates' },
};

/**
 * The installable packages of a release, by operating system and architecture.
 * @param release - A release.
 */
export function packagesOf(release: Release): Package[] {
  const packages: Package[] = [];
  for (const asset of release.assets) {
    const match =
      /-(windows|macos|linux)-(x64|x86_64|amd64|arm64|aarch64)[-.](setup\.exe|msi|dmg|AppImage|deb|rpm)$/.exec(
        asset.name,
      );
    const kind = match?.[3] === undefined ? undefined : formats[match[3]];
    const os = operatingSystems.find((name) => name === match?.[1]);
    if (match === null || kind === undefined || os === undefined) continue;
    packages.push({
      ...asset,
      os,
      arch: match[2] === 'arm64' || match[2] === 'aarch64' ? 'arm64' : 'x64',
      ...kind,
    });
  }
  return packages.toSorted(
    (a, b) =>
      operatingSystems.indexOf(a.os) - operatingSystems.indexOf(b.os) ||
      b.arch.localeCompare(a.arch),
  );
}

/** The verification files of a release: checksums, signatures and the SBOM. */
export function verificationFilesOf(release: Release): Asset[] {
  return release.assets.filter((a) => /^(SHA256SUMS(\.sig|\.asc)?|.*\.cdx\.json)$/.test(a.name));
}

/** A size in MB with one decimal. */
export function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
