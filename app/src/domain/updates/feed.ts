import * as v from 'valibot';
import { compareVersions, isVersion, matchesVersionPrefix } from './version.ts';

/** Update channels. The beta channel also receives stable releases. */
export const UpdateChannelSchema = v.picklist(['stable', 'beta']);

/** An update channel. */
export type UpdateChannel = v.InferOutput<typeof UpdateChannelSchema>;

const versionSchema = v.pipe(v.string(), v.check(isVersion, 'Must be a semantic version'));
const timestamp = v.pipe(v.string(), v.isoTimestamp());
const fileName = v.pipe(v.string(), v.regex(/^[\w.-]+$/, 'Must be a plain file name'));
const size = v.pipe(v.number(), v.integer(), v.minValue(0));

/** `updates/v1/index.json`: the releases per channel and the freshness fields. */
export const FeedIndexSchema = v.object({
  schemaVersion: v.literal(1),
  // Monotonic counter; clients never accept a lower value than the last one they saw.
  sequence: v.pipe(v.number(), v.integer(), v.minValue(0)),
  issuedAt: timestamp,
  expiresAt: timestamp,
  releases: v.array(v.object({ version: versionSchema, channel: UpdateChannelSchema })),
});

/** The signed index of the feed. */
export type FeedIndex = v.InferOutput<typeof FeedIndexSchema>;

/** One downloadable file of a release. */
export const ReleaseArtifactSchema = v.object({
  file: fileName,
  size,
  // SHA-512 of the file, Base64-encoded as electron-updater expects.
  sha512: v.pipe(v.string(), v.regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be Base64')),
  // Size of the blockmap embedded at the end of the file, where the format has one.
  blockMapSize: v.optional(size),
});

/** One downloadable file of a release. */
export type ReleaseArtifact = v.InferOutput<typeof ReleaseArtifactSchema>;

/** `updates/v1/releases/<version>.json`: the files of one release. */
export const ReleaseManifestSchema = v.object({
  schemaVersion: v.literal(1),
  version: versionSchema,
  releaseDate: timestamp,
  // Where the files are, relative to the feed or absolute.
  downloadBase: v.string(),
  // Files by `<platform>-<arch>-<format>`, such as `win32-x64-nsis`.
  artifacts: v.record(v.string(), ReleaseArtifactSchema),
});

/** The signed manifest of one release. */
export type ReleaseManifest = v.InferOutput<typeof ReleaseManifestSchema>;

/** Why a feed was rejected. */
export type FeedErrorCode =
  'unavailable' | 'signature' | 'invalid' | 'rollback' | 'expired' | 'mismatch' | 'no-artifact';

/** A feed that cannot be trusted or used. Nothing is installed after such an error. */
export class FeedError extends Error {
  override readonly name = 'FeedError';
  /** Why the feed was rejected. */
  readonly code: FeedErrorCode;

  /**
   * @param code - Why the feed was rejected.
   * @param message - Details for logs and diagnostics.
   */
  constructor(code: FeedErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Checks detached Ed25519 signatures against the public keys built into the browser. */
export interface SignatureVerifier {
  /**
   * @param data - The signed text; its UTF-8 bytes are what was signed.
   * @param signature - The detached signature, Base64-encoded.
   * @returns Whether any trusted key made the signature.
   */
  verify(data: string, signature: string): boolean;
}

/** Loads feed files from GitHub Pages or a mirror. */
export interface FeedFetcher {
  /**
   * @param path - Path relative to the feed root, such as `updates/v1/index.json`.
   * @returns The file as UTF-8 text, or `undefined` when the file does not exist.
   */
  fetch(path: string): Promise<string | undefined>;
}

/** Remembers the highest index sequence seen, to detect rollback attacks. */
export interface FeedStateStore {
  /** Returns the highest sequence seen so far, or 0. */
  readSequence(): number;
  /**
   * Stores a higher sequence.
   * @param sequence - Sequence of a verified index.
   */
  writeSequence(sequence: number): void;
}

/** What the browser asks the feed for. */
export interface ReleaseQuery {
  readonly channel: UpdateChannel;
  /** Only versions with this prefix, from the `TargetVersionPrefix` policy. */
  readonly versionPrefix?: string;
  /** The running version. */
  readonly currentVersion: string;
  /** Platform, architecture and package format, such as `linux-x64-appimage`. */
  readonly artifactKey: string;
  /** Versions that failed to start here and are never installed again. */
  readonly blocked?: readonly string[];
}

/** A verified release that is newer than the running version. */
export interface AvailableUpdate {
  readonly manifest: ReleaseManifest;
  readonly artifact: ReleaseArtifact;
}

/**
 * Picks the release to update to: the highest version of the channel that matches the
 * prefix and is newer than the running one. Downgrades are never selected.
 * @param index - The verified index.
 * @param query - Channel, prefix and running version.
 */
export function selectRelease(index: FeedIndex, query: ReleaseQuery): string | undefined {
  const candidates = index.releases
    .filter((release) => query.channel === 'beta' || release.channel === 'stable')
    .map((release) => release.version)
    .filter((version) => matchesVersionPrefix(version, query.versionPrefix ?? ''))
    .filter((version) => compareVersions(version, query.currentVersion) > 0)
    .filter((version) => !(query.blocked ?? []).includes(version))
    .toSorted(compareVersions);
  return candidates.at(-1);
}

/**
 * The signed update feed. Every file is verified before it is parsed, and the index must
 * be fresh and must not go back in sequence.
 */
export class SignedFeed {
  private readonly fetcher: FeedFetcher;
  private readonly verifier: SignatureVerifier;
  private readonly state: FeedStateStore;
  private readonly now: () => number;

  /**
   * @param fetcher - Loads feed files.
   * @param verifier - Checks signatures.
   * @param state - Highest sequence seen so far.
   * @param now - Current wall time in milliseconds since the epoch.
   */
  constructor(
    fetcher: FeedFetcher,
    verifier: SignatureVerifier,
    state: FeedStateStore,
    now: () => number,
  ) {
    this.fetcher = fetcher;
    this.verifier = verifier;
    this.state = state;
    this.now = now;
  }

  /**
   * Looks for an update.
   * @param query - What to look for.
   * @returns The release and its file for this platform, or `undefined` when the browser
   *   is up to date.
   * @throws {FeedError} When the feed cannot be trusted or has no file for this platform.
   */
  async findUpdate(query: ReleaseQuery): Promise<AvailableUpdate | undefined> {
    const index = await this.load('updates/v1/index.json', FeedIndexSchema);
    const lastSequence = this.state.readSequence();
    if (index.sequence < lastSequence) {
      throw new FeedError('rollback', `Sequence ${index.sequence} is older than ${lastSequence}`);
    }
    if (Date.parse(index.expiresAt) <= this.now()) {
      throw new FeedError('expired', `The feed expired at ${index.expiresAt}`);
    }
    this.state.writeSequence(index.sequence);
    const version = selectRelease(index, query);
    if (version === undefined) return undefined;
    const manifest = await this.manifest(version);
    const artifact = manifest.artifacts[query.artifactKey];
    if (artifact === undefined) {
      throw new FeedError('no-artifact', `Release ${version} has no file for ${query.artifactKey}`);
    }
    return { manifest, artifact };
  }

  /**
   * Loads and verifies the manifest of one version, such as the running one, whose package
   * the boot guard keeps for a rollback.
   * @param version - The version.
   * @throws {FeedError} When the manifest cannot be trusted.
   */
  async manifest(version: string): Promise<ReleaseManifest> {
    const manifest = await this.load(`updates/v1/releases/${version}.json`, ReleaseManifestSchema);
    if (manifest.version !== version) {
      throw new FeedError('mismatch', `The manifest of ${version} describes ${manifest.version}`);
    }
    return manifest;
  }

  private async load<T>(path: string, schema: v.GenericSchema<unknown, T>): Promise<T> {
    const [data, signature] = await Promise.all([
      this.fetcher.fetch(path),
      this.fetcher.fetch(`${path}.sig`),
    ]);
    if (data === undefined || signature === undefined) {
      throw new FeedError('unavailable', `${path} or its signature is missing`);
    }
    if (!this.verifier.verify(data, signature.trim())) {
      throw new FeedError('signature', `The signature of ${path} is not valid`);
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      throw new FeedError('invalid', `${path} is not JSON`);
    }
    const parsed = v.safeParse(schema, json);
    if (!parsed.success) {
      throw new FeedError('invalid', `${path}: ${parsed.issues[0].message}`);
    }
    return parsed.output;
  }
}
