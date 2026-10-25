// Update provider that only returns data from an Ed25519-signed feed.
import { verify, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import updater from 'electron-updater';

const { Provider } = updater;

export class FeedError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Verifies a detached signature against any of the embedded public keys. */
export function verifySigned(bytes, signatureBase64, publicKeys) {
  const signature = Buffer.from(signatureBase64.trim(), 'base64');
  return publicKeys.some((pem) => verify(null, bytes, createPublicKey(pem), signature));
}

export class SignedFeedProvider extends Provider {
  constructor(options, appUpdater, runtimeOptions) {
    super({ ...runtimeOptions, isUseMultipleRangeRequest: false });
    this.options = options;
    this.appUpdater = appUpdater;
    this.base = new URL(options.url);
    this.manifest = null;
  }

  async fetchSigned(path) {
    const url = new URL(path, this.base);
    const body = await this.httpRequest(url);
    const sig = await this.httpRequest(new URL(`${url.pathname}.sig`, url));
    if (body == null || sig == null) throw new FeedError('ERR_FEED_MISSING', `missing ${url}`);
    if (!verifySigned(Buffer.from(body, 'utf8'), sig, this.options.publicKeys)) {
      throw new FeedError('ERR_FEED_SIGNATURE', `invalid signature for ${url.pathname}`);
    }
    return JSON.parse(body);
  }

  readSequence() {
    try {
      return JSON.parse(readFileSync(this.options.stateFile, 'utf8')).sequence ?? 0;
    } catch {
      return 0;
    }
  }

  async getLatestVersion() {
    const index = await this.fetchSigned('updates/v1/index.json');
    const seen = this.readSequence();
    if (!Number.isInteger(index.sequence) || index.sequence < seen) {
      throw new FeedError('ERR_FEED_ROLLBACK', `sequence ${index.sequence} is older than ${seen}`);
    }
    if (!(Date.parse(index.expiresAt) > Date.now())) {
      throw new FeedError('ERR_FEED_EXPIRED', `feed expired at ${index.expiresAt}`);
    }
    mkdirSync(dirname(this.options.stateFile), { recursive: true });
    writeFileSync(this.options.stateFile, JSON.stringify({ sequence: index.sequence }));
    const version = index.channels?.[this.options.channel]?.version;
    if (!version) throw new FeedError('ERR_FEED_CHANNEL', `no ${this.options.channel} release`);
    const manifest = await this.fetchSigned(`updates/v1/releases/${version}.json`);
    if (manifest.version !== version) throw new FeedError('ERR_FEED_MISMATCH', 'version mismatch');
    const key = `${process.platform}-${process.arch}-${this.options.format}`;
    const artifact = manifest.artifacts?.[key];
    if (!artifact) throw new FeedError('ERR_FEED_ARTIFACT', `no artifact for ${key}`);
    this.manifest = manifest;
    return {
      version,
      releaseDate: manifest.releaseDate,
      path: artifact.file,
      sha512: artifact.sha512,
      files: [
        {
          url: artifact.file,
          sha512: artifact.sha512,
          size: artifact.size,
          ...(artifact.blockMapSize ? { blockMapSize: artifact.blockMapSize } : {}),
        },
      ],
    };
  }

  resolveFiles(info) {
    const base = new URL(this.manifest.downloadBase, this.base);
    return info.files.map((file) => ({ url: new URL(file.url, base), info: file }));
  }
}
