/**
 * Builds and signs the update feed described in docs/architecture/updates.md, and serves
 * a feed folder locally for the updater tests.
 *
 *   node tools/feed/feed.ts keygen <dir>
 *     Writes an Ed25519 key pair: `<dir>/update-<name>.pub.pem` and `<dir>/private.pem`.
 *   node tools/feed/feed.ts manifest --packages <dir> [--packages <dir> ...] --version <v>
 *       --out <file> [--download-base <url>]
 *     Writes the unsigned manifest of one release from electron-builder's update info files
 *     (`latest*.yml`, or `<channel>*.yml` for prereleases), after checking them against the
 *     files. Each build writes its own info files, so the folders of all builds are given.
 *     The release pipeline attaches the result to the release as `update-manifest.json`.
 *   node tools/feed/feed.ts site --releases <releases.json> --manifests <dir> --key <private.pem>
 *       --out <site> [--sequence <n>] [--expires-days <n>]
 *     Signs the manifests of all published releases and writes a fresh signed index into
 *     `<site>/updates/v1/`. The sequence defaults to the current Unix time in seconds, so
 *     every deployment has a higher sequence than the one before without stored state.
 *   node tools/feed/feed.ts build --packages <dir> --version <v> --channel <stable|beta>
 *       --key <private.pem> --out <site> [--download-base <url>] [--index <index.json>]
 *       [--expires-days <n>]
 *     Both steps for a single release, adding it to an existing index; used by the updater
 *     tests.
 *   node tools/feed/feed.ts sign --key <private.pem> <file>...
 *     Writes `<file>.sig` with the base64 Ed25519 signature of each file.
 *   node tools/feed/feed.ts serve <dir> <port>
 *     Serves a folder on 127.0.0.1 with range requests, as GitHub serves releases. */
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, sep } from 'node:path';

/** One file entry of electron-builder's `latest*.yml`. */
interface UpdateInfoFile {
  url: string;
  sha512: string;
  size: number;
  blockMapSize?: number;
}

interface Release {
  readonly version: string;
  readonly channel: 'stable' | 'beta';
}

const [command, ...args] = process.argv.slice(2);

/** Every value of an option that may be repeated. */
function options(name: string): string[] {
  return args.flatMap((arg, i) =>
    arg === `--${name}` && args[i + 1] !== undefined ? [args[i + 1] ?? ''] : [],
  );
}

function option(name: string, fallback?: string): string {
  const index = args.indexOf(`--${name}`);
  const value = index === -1 ? fallback : args[index + 1];
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
}

/**
 * Reads the `files` list of an update info file. The format is fixed and flat, so a small
 * parser is enough and no YAML library is needed.
 * @param text - The file content.
 */
function parseUpdateInfo(text: string): UpdateInfoFile[] {
  const files: UpdateInfoFile[] = [];
  let current: Partial<UpdateInfoFile> | undefined;
  let inFiles = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles && /^\S/.test(line)) inFiles = false;
    if (!inFiles) continue;
    const entry = /^\s*(-\s+)?(\w+):\s*'?([^']*?)'?\s*$/.exec(line);
    if (entry === null) continue;
    const [, dash, key = '', value = ''] = entry;
    if (dash !== undefined) {
      current = {};
      files.push(current as UpdateInfoFile);
    }
    if (current === undefined) continue;
    if (key === 'url' || key === 'sha512') current[key] = value;
    if (key === 'size' || key === 'blockMapSize') current[key] = Number(value);
  }
  return files;
}

/**
 * The manifest key of a package, from its versionless asset name.
 * @param file - Asset name, such as `lampo-linux-x86_64.AppImage`.
 */
function artifactKey(file: string): string | undefined {
  const windows = /-windows-(x64|arm64)-setup\.exe$/.exec(file);
  if (windows !== null) return `win32-${windows[1]}-nsis`;
  const linux = /-linux-(x86_64|arm64)\.AppImage$/.exec(file);
  if (linux !== null) return `linux-${linux[1] === 'x86_64' ? 'x64' : 'arm64'}-appimage`;
  const mac = /-macos-(x64|arm64)\.zip$/.exec(file);
  if (mac !== null) return `darwin-${mac[1]}-zip`;
  return undefined;
}

function writeSigned(path: string, value: unknown, key: KeyObject): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text);
  writeFileSync(
    `${path}.sig`,
    `${sign(null, Buffer.from(text, 'utf8'), key).toString('base64')}\n`,
  );
}

function keygen(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(
    join(dir, 'update-test.pub.pem'),
    publicKey.export({ type: 'spki', format: 'pem' }),
  );
  writeFileSync(join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
  console.log(`Wrote a key pair to ${dir}`);
}

/** The manifest of one release, as published in `updates/v1/releases/<version>.json`. */
interface Manifest {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly releaseDate: string;
  readonly downloadBase: string;
  readonly artifacts: Record<string, Omit<UpdateInfoFile, 'url'> & { file: string }>;
}

function createManifest(
  folders: readonly string[],
  version: string,
  downloadBase: string,
  releaseDate: Date,
): Manifest {
  const artifacts: Manifest['artifacts'] = {};
  for (const packages of folders) {
    for (const name of readdirSync(packages).filter(
      (n) => n.endsWith('.yml') && !n.startsWith('builder-'),
    )) {
      for (const file of parseUpdateInfo(readFileSync(join(packages, name), 'utf8'))) {
        const keyName = artifactKey(file.url);
        if (keyName === undefined) continue;
        const bytes = readFileSync(join(packages, file.url));
        const sha512 = createHash('sha512').update(bytes).digest('base64');
        if (sha512 !== file.sha512 || bytes.length !== file.size) {
          throw new Error(`${file.url} does not match ${name}`);
        }
        artifacts[keyName] = {
          file: file.url,
          sha512,
          size: bytes.length,
          ...(file.blockMapSize === undefined ? {} : { blockMapSize: file.blockMapSize }),
        };
      }
    }
  }
  if (Object.keys(artifacts).length === 0)
    throw new Error(`No update files in ${folders.join(', ')}`);
  return {
    schemaVersion: 1,
    version,
    releaseDate: releaseDate.toISOString(),
    downloadBase,
    artifacts,
  };
}

function defaultDownloadBase(version: string): string {
  return `https://github.com/${readBrand().repository}/releases/download/v${version}/`;
}

function writeIndex(
  feedDir: string,
  releases: readonly Release[],
  sequence: number,
  key: KeyObject,
): void {
  const days = Number(option('expires-days', '30'));
  const now = Date.now();
  writeSigned(
    join(feedDir, 'index.json'),
    {
      schemaVersion: 1,
      sequence,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + days * 86_400_000).toISOString(),
      releases,
    },
    key,
  );
}

function manifest(): void {
  const version = option('version');
  const out = resolve(option('out'));
  const folders = options('packages').map((dir) => resolve(dir));
  if (folders.length === 0) throw new Error('Missing --packages');
  const value = createManifest(
    folders,
    version,
    option('download-base', defaultDownloadBase(version)),
    new Date(),
  );
  writeFileSync(out, `${JSON.stringify(value, null, 2)}\n`);
  console.log(
    `Wrote the manifest of ${version} with ${Object.keys(value.artifacts).length} artifacts`,
  );
}

function site(): void {
  const releases = (
    JSON.parse(readFileSync(option('releases'), 'utf8')) as {
      releases: { version: string; channel: Release['channel'] }[];
    }
  ).releases.map(({ version, channel }): Release => ({ version, channel }));
  const manifests = resolve(option('manifests'));
  const key = createPrivateKey(readFileSync(option('key')));
  const feedDir = join(resolve(option('out')), 'updates', 'v1');
  mkdirSync(join(feedDir, 'releases'), { recursive: true });
  for (const { version } of releases) {
    const value = JSON.parse(readFileSync(join(manifests, `${version}.json`), 'utf8')) as Manifest;
    if (value.version !== version)
      throw new Error(`The manifest of ${version} names ${value.version}`);
    writeSigned(join(feedDir, 'releases', `${version}.json`), value, key);
  }
  writeIndex(
    feedDir,
    releases,
    Number(option('sequence', String(Math.floor(Date.now() / 1000)))),
    key,
  );
  console.log(`Signed the feed with ${releases.length} releases`);
}

function build(): void {
  const packages = resolve(option('packages'));
  const version = option('version');
  const channel = option('channel', 'stable');
  if (channel !== 'stable' && channel !== 'beta')
    throw new Error('--channel must be stable or beta');
  const key = createPrivateKey(readFileSync(option('key')));
  const out = resolve(option('out'));
  const value = createManifest(
    [packages],
    version,
    option('download-base', defaultDownloadBase(version)),
    new Date(),
  );
  const feedDir = join(out, 'updates', 'v1');
  mkdirSync(join(feedDir, 'releases'), { recursive: true });
  writeSigned(join(feedDir, 'releases', `${version}.json`), value, key);

  const previousPath = option('index', join(feedDir, 'index.json'));
  const previous = existsSync(previousPath)
    ? (JSON.parse(readFileSync(previousPath, 'utf8')) as { sequence: number; releases: Release[] })
    : { sequence: 0, releases: [] };
  writeIndex(
    feedDir,
    [...previous.releases.filter((r) => r.version !== version), { version, channel }],
    previous.sequence + 1,
    key,
  );
  console.log(`Added ${version} to the feed in ${out}`);
}

function signFiles(): void {
  const key = createPrivateKey(readFileSync(option('key')));
  const files = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--key');
  if (files.length === 0) throw new Error('No files to sign');
  for (const file of files) {
    writeFileSync(`${file}.sig`, `${sign(null, readFileSync(file), key).toString('base64')}\n`);
  }
  console.log(`Signed ${files.length} file(s)`);
}

function readBrand(): { repository: string } {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, '../../brand.json'), 'utf8')) as {
    repository: string;
  };
}

function serve(dir: string, port: number): void {
  const root = resolve(dir);
  createServer((request, response) => {
    const path = resolve(
      root,
      `.${decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)}`,
    );
    if (!path.startsWith(`${root}${sep}`) || !existsSync(path) || !statSync(path).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const size = statSync(path).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
    if (range === null) {
      response.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' });
      createReadStream(path).pipe(response);
      return;
    }
    const [, from = '', to = ''] = range;
    const start = from === '' ? size - Number(to) : Number(from);
    const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
    response.writeHead(206, {
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': end - start + 1,
      'accept-ranges': 'bytes',
    });
    createReadStream(path, { start, end }).pipe(response);
  }).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://127.0.0.1:${port}/`));
}

if (command === 'keygen') keygen(resolve(args[0] ?? 'keys'));
else if (command === 'manifest') manifest();
else if (command === 'site') site();
else if (command === 'build') build();
else if (command === 'sign') signFiles();
else if (command === 'serve') serve(args[0] ?? '.', Number(args[1] ?? '8080'));
else {
  console.error('Usage: node tools/feed/feed.ts keygen|manifest|site|build|sign|serve …');
  process.exit(1);
}
