// Spike helpers: key generation, feed generation and a static server with Range support.
//   node tools.mjs keys <dir>
//   node tools.mjs feed --dist <dir> --out <dir> --key <pem> --version <v> --sequence <n>
//                       [--expires-days <n>] [--tamper] [--format <nsis|appimage|zip>]
//   node tools.mjs serve <dir> <port> <logfile>
import { generateKeyPairSync, sign, createHash, createPrivateKey } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  createReadStream,
  appendFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = rest.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = rest[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

if (cmd === 'keys') {
  const dir = rest[0];
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(join(dir, 'feed-current.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(
    join(dir, '..', 'feed-private.pem'),
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  );
}

function signFile(file, key, tamper) {
  let bytes = readFileSync(file);
  const signature = sign(null, bytes, key).toString('base64');
  if (tamper) writeFileSync(file, Buffer.concat([bytes, Buffer.from(' ')]));
  writeFileSync(`${file}.sig`, `${signature}\n`);
}

if (cmd === 'feed') {
  const dist = opt('dist');
  const out = opt('out');
  const version = opt('version');
  const key = createPrivateKey(readFileSync(opt('key')));
  const format = opt('format');
  const now = Date.now();
  const days = Number(opt('expires-days', '30'));
  const download = join(out, 'download', `v${version}`);
  mkdirSync(download, { recursive: true });
  mkdirSync(join(out, 'updates', 'v1', 'releases'), { recursive: true });
  const artifacts = {};
  const ext = { nsis: '.exe', appimage: '.AppImage', zip: '.zip' }[format];
  for (const name of readdirSync(dist)) {
    const full = join(dist, name);
    if (!statSync(full).isFile()) continue;
    if (
      name.endsWith('.blockmap') ||
      name.endsWith('.exe') ||
      name.endsWith('.AppImage') ||
      name.endsWith('.zip') ||
      name.endsWith('.dmg')
    ) {
      copyFileSync(full, join(download, name));
    }
    if (extname(name) !== ext) continue;
    const bytes = readFileSync(full);
    // electron-builder records the size of an embedded block map (AppImage) in latest*.yml.
    let blockMapSize;
    for (const yml of readdirSync(dist).filter((f) => /^latest.*\.yml$/.test(f))) {
      const m = new RegExp(
        `url: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+sha512: \\S+\\s+size: \\d+\\s+blockMapSize: (\\d+)`,
      ).exec(readFileSync(join(dist, yml), 'utf8'));
      if (m) blockMapSize = Number(m[1]);
    }
    artifacts[`${opt('platform')}-${opt('arch')}-${format}`] = {
      file: name,
      size: bytes.length,
      sha512: createHash('sha512').update(bytes).digest('base64'),
      ...(blockMapSize ? { blockMapSize } : {}),
    };
  }
  const manifest = {
    version,
    releaseDate: new Date(now).toISOString(),
    downloadBase: `../../download/v${version}/`,
    artifacts,
  };
  const manifestFile = join(out, 'updates', 'v1', 'releases', `${version}.json`);
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  signFile(manifestFile, key, false);
  const index = {
    sequence: Number(opt('sequence')),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * 86_400_000).toISOString(),
    channels: { stable: { version }, beta: { version } },
  };
  const indexFile = join(out, 'updates', 'v1', 'index.json');
  writeFileSync(indexFile, JSON.stringify(index, null, 2));
  signFile(indexFile, key, opt('tamper') === true);
  console.log(JSON.stringify({ index, manifest }, null, 2));
}

if (cmd === 'serve') {
  const [root, port, logfile] = rest;
  createServer((req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    let size;
    try {
      size = statSync(path).size;
    } catch {
      res.writeHead(404).end();
      appendFileSync(logfile, `${req.method} ${req.url} 404\n`);
      return;
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
      const end = range[1] === '' || range[2] === '' ? size - 1 : Number(range[2]);
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': end - start + 1,
        'accept-ranges': 'bytes',
      });
      createReadStream(path, { start, end }).pipe(res);
      appendFileSync(logfile, `${req.method} ${req.url} 206 ${end - start + 1}\n`);
    } else {
      res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' });
      createReadStream(path).pipe(res);
      appendFileSync(logfile, `${req.method} ${req.url} 200 ${size}\n`);
    }
  }).listen(Number(port), '127.0.0.1');
}
