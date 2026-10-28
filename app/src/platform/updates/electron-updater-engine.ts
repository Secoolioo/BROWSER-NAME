import {
  autoUpdater,
  Provider,
  type AppUpdater,
  type ProgressInfo,
  type ResolvedUpdateFileInfo,
  type UpdateInfo,
} from 'electron-updater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import type { CustomPublishOptions } from 'builder-util-runtime';
import type { Logger } from '../../kernel/logging/logger.ts';
import { SignedFeed, type AvailableUpdate, type ReleaseQuery } from '../../domain/updates/feed.ts';
import type { UpdateEngine } from '../../domain/updates/update-service.ts';

/** What the provider needs; passed through electron-updater's custom provider options. */
interface SignedFeedOptions {
  readonly feed: SignedFeed;
  readonly query: ReleaseQuery;
  readonly feedBase: URL;
}

/**
 * electron-updater provider that only returns data from the verified feed. electron-updater
 * then downloads the file, applies the blockmap delta, checks the SHA-512 from the signed
 * manifest and installs.
 */
class SignedFeedProvider extends Provider<UpdateInfo> {
  private readonly options: SignedFeedOptions;
  private found: AvailableUpdate | undefined;

  constructor(
    options: CustomPublishOptions,
    _updater: AppUpdater,
    runtime: ProviderRuntimeOptions,
  ) {
    // GitHub Releases answers multi-range requests with the whole file; use single ranges.
    super({ ...runtime, isUseMultipleRangeRequest: false });
    const { feed, query, feedBase } = options;
    if (!(feed instanceof SignedFeed) || !(feedBase instanceof URL) || typeof query !== 'object') {
      throw new TypeError('The signed feed provider needs a feed, a query and a base URL');
    }
    this.options = { feed, feedBase, query };
  }

  override async getLatestVersion(): Promise<UpdateInfo> {
    const found = await this.options.feed.findUpdate(this.options.query);
    this.found = found;
    if (found === undefined) {
      // electron-updater treats an equal version as "no update".
      return {
        version: this.options.query.currentVersion,
        files: [],
        path: '',
        sha512: '',
        releaseDate: '',
      };
    }
    const { manifest, artifact } = found;
    return {
      version: manifest.version,
      releaseDate: manifest.releaseDate,
      path: artifact.file,
      sha512: artifact.sha512,
      files: [
        {
          url: artifact.file,
          sha512: artifact.sha512,
          size: artifact.size,
          ...(artifact.blockMapSize === undefined ? {} : { blockMapSize: artifact.blockMapSize }),
        },
      ],
    };
  }

  override resolveFiles(info: UpdateInfo): ResolvedUpdateFileInfo[] {
    if (this.found === undefined) return [];
    const base = new URL(this.found.manifest.downloadBase, this.options.feedBase);
    return info.files.map((file) => ({ url: new URL(file.url, base), info: file }));
  }
}

/**
 * Creates the update engine on top of electron-updater. Nothing installs on its own: the
 * update service decides when to download and starts the installation while the browser
 * exits.
 * @param options - Feed, query and logger.
 */
export function createElectronUpdaterEngine(
  options: SignedFeedOptions & { readonly logger: Logger },
): UpdateEngine {
  const updater = autoUpdater;
  const log = options.logger;
  updater.logger = {
    info: (message?: unknown) => log.debug(String(message)),
    warn: (message?: unknown) => log.warn(String(message)),
    error: (message?: unknown) => log.error(String(message)),
    debug: (message?: unknown) => log.trace(String(message)),
  };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  updater.setFeedURL({
    provider: 'custom',
    updateProvider: SignedFeedProvider,
    feed: options.feed,
    query: options.query,
    feedBase: options.feedBase,
  });
  return {
    async check(): Promise<string | undefined> {
      const result = await updater.checkForUpdates();
      return result?.isUpdateAvailable === true ? result.updateInfo.version : undefined;
    },
    async download(onProgress: (percent: number) => void): Promise<void> {
      const listener = (progress: ProgressInfo): void => onProgress(progress.percent);
      updater.on('download-progress', listener);
      try {
        await updater.downloadUpdate();
      } finally {
        updater.off('download-progress', listener);
      }
    },
    install(): void {
      // Windows and Linux updaters install from here; on macOS, Squirrel applies the
      // downloaded update when the browser has quit.
      if ('install' in updater && typeof updater.install === 'function') {
        updater.install(true, false);
      }
    },
  };
}
