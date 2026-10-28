/**
 * Builds the signed APT and DNF repositories described in docs/architecture/updates.md.
 *
 *   node tools/linux-repo/repo.ts sign-rpms <dir>
 *     Signs every rpm in a folder with the repository key (rpmsign).
 *   node tools/linux-repo/repo.ts build --site <dir> --download-base <url> <version>:<channel>:<dir> ...
 *     Writes `apt/` and `rpm/` into the site folder from the packages of each release, newest
 *     last. The deb files are copied into the APT pool; the rpm metadata points to
 *     `<download-base>v<version>/<file>`, so rpm packages are served from the releases.
 *
 * The stable channel lists the last two stable releases; the beta channel lists the last two
 * releases of any kind. The key comes from `GNUPGHOME`; `REPO_KEY_ID` selects it when the
 * keyring holds more than one. Needs gpg, dpkg-deb, apt-ftparchive, rpm and createrepo_c.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

interface Release {
  readonly version: string;
  readonly channel: 'stable' | 'beta';
  readonly dir: string;
}

const kept = 2;

function run(command: string, args: readonly string[], cwd?: string): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...(cwd === undefined ? {} : { cwd }),
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}${result.stdout}`);
  }
  return result.stdout;
}

function keyId(): string {
  const configured = process.env['REPO_KEY_ID'];
  if (configured !== undefined && configured !== '') return configured;
  const listing = run('gpg', ['--batch', '--list-secret-keys', '--with-colons']);
  const fingerprint = /^fpr:+([0-9A-F]+):/m.exec(listing)?.[1];
  if (fingerprint === undefined) throw new Error('No secret key in GNUPGHOME');
  return fingerprint;
}

function signRpms(dir: string): void {
  const key = keyId();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.rpm'))) {
    run('rpmsign', ['--define', `_gpg_name ${key}`, '--addsign', join(dir, name)]);
    console.log(`Signed ${name}`);
  }
}

/** Releases a channel lists: the newest two of the channel; beta also lists stable ones. */
function listed(releases: readonly Release[], channel: 'stable' | 'beta'): Release[] {
  return releases.filter((r) => channel === 'beta' || r.channel === 'stable').slice(-kept);
}

function buildApt(site: string, releases: readonly Release[], key: string): void {
  const apt = join(site, 'apt');
  const pool = join('pool', 'main');
  rmSync(apt, { recursive: true, force: true });
  mkdirSync(join(apt, pool), { recursive: true });
  for (const channel of ['stable', 'beta'] as const) {
    // Each channel indexes its own packages; the files share one pool, so a release that
    // both channels list is stored once.
    const stage = mkdtempSync(join(tmpdir(), `apt-${channel}-`));
    mkdirSync(join(stage, pool), { recursive: true });
    // Both architectures always get an index, so a channel without releases stays valid.
    const architectures = new Set<string>(['amd64', 'arm64']);
    for (const release of listed(releases, channel)) {
      for (const name of readdirSync(release.dir).filter((n) => n.endsWith('.deb'))) {
        const file = join(release.dir, name);
        const fields = run('dpkg-deb', ['--field', file, 'Package', 'Version', 'Architecture']);
        const value = (field: string): string =>
          new RegExp(`^${field}: (.+)$`, 'm').exec(fields)?.[1]?.trim() ?? '';
        const architecture = value('Architecture');
        architectures.add(architecture);
        const canonical = `${value('Package')}_${value('Version')}_${architecture}.deb`;
        copyFileSync(file, join(stage, pool, canonical));
        if (!existsSync(join(apt, pool, canonical))) copyFileSync(file, join(apt, pool, canonical));
      }
    }
    const dist = join(apt, 'dists', channel);
    for (const architecture of architectures) {
      const target = join(dist, 'main', `binary-${architecture}`);
      mkdirSync(target, { recursive: true });
      const packages = run('apt-ftparchive', ['--arch', architecture, 'packages', pool], stage);
      writeFileSync(join(target, 'Packages'), packages);
      run('gzip', ['-kf9', join(target, 'Packages')]);
    }
    rmSync(stage, { recursive: true, force: true });
    const release = run(
      'apt-ftparchive',
      [
        '-o',
        `APT::FTPArchive::Release::Suite=${channel}`,
        '-o',
        `APT::FTPArchive::Release::Codename=${channel}`,
        '-o',
        'APT::FTPArchive::Release::Components=main',
        '-o',
        `APT::FTPArchive::Release::Architectures=${[...architectures].toSorted().join(' ')}`,
        'release',
        join('dists', channel),
      ],
      apt,
    );
    writeFileSync(join(dist, 'Release'), release);
    const sign = (args: readonly string[]): string =>
      run('gpg', ['--batch', '--yes', '-u', key, ...args, join(dist, 'Release')]);
    sign(['--clearsign', '-o', join(dist, 'InRelease')]);
    sign(['--armor', '--detach-sign', '-o', join(dist, 'Release.gpg')]);
  }
}

function buildRpm(
  site: string,
  releases: readonly Release[],
  downloadBase: string,
  key: string,
): void {
  const rpm = join(site, 'rpm');
  rmSync(rpm, { recursive: true, force: true });
  for (const channel of ['stable', 'beta'] as const) {
    const stage = mkdtempSync(join(tmpdir(), `rpm-${channel}-`));
    for (const release of listed(releases, channel)) {
      const target = join(stage, `v${release.version}`);
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(release.dir).filter((n) => n.endsWith('.rpm'))) {
        copyFileSync(join(release.dir, name), join(target, name));
      }
    }
    run('createrepo_c', ['--quiet', '--baseurl', downloadBase, stage]);
    const out = join(rpm, channel);
    mkdirSync(out, { recursive: true });
    run('cp', ['-r', join(stage, 'repodata'), out]);
    const repomd = join(out, 'repodata', 'repomd.xml');
    run('gpg', [
      '--batch',
      '--yes',
      '-u',
      key,
      '--armor',
      '--detach-sign',
      '-o',
      `${repomd}.asc`,
      repomd,
    ]);
    rmSync(stage, { recursive: true, force: true });
  }
}

function build(args: readonly string[]): void {
  const value = (name: string): string => {
    const index = args.indexOf(`--${name}`);
    const found = args[index + 1];
    if (index === -1 || found === undefined) throw new Error(`Missing --${name}`);
    return found;
  };
  const site = resolve(value('site'));
  const downloadBase = value('download-base');
  const releases = args
    .filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'))
    .map((spec): Release => {
      const [version = '', channel = '', ...dir] = spec.split(':');
      if (channel !== 'stable' && channel !== 'beta') throw new Error(`Bad release ${spec}`);
      return { version, channel, dir: resolve(dir.join(':')) };
    });
  if (releases.length === 0) throw new Error('No releases given');
  const key = keyId();
  buildApt(site, releases, key);
  buildRpm(site, releases, downloadBase, key);
  run('gpg', ['--batch', '--yes', '--armor', '--export', '-o', join(site, 'linux-repo.asc'), key]);
  console.log(`Wrote the package repositories to ${site}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'sign-rpms') signRpms(resolve(rest[0] ?? '.'));
else if (command === 'build') build(rest);
else {
  console.error('Usage: node tools/linux-repo/repo.ts sign-rpms <dir> | build …');
  process.exit(1);
}
