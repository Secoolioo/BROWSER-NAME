import { app, net } from 'electron';
import { join } from 'node:path';
import type { Logger } from '../kernel/logging/logger.ts';
import type { Clock } from '../kernel/time/clock.ts';
import type { PolicyService } from '../domain/policy/policy-service.ts';
import { SignedFeed } from '../domain/updates/feed.ts';
import {
  AutoUpdateCheckPeriodMinutes,
  TargetChannel,
  TargetVersionPrefix,
  UpdatePolicy,
  UpdateURL,
  defaultCheckPeriodMinutes,
  updateMode,
} from '../domain/updates/update-policies.ts';
import { UpdateService, type UpdateEngine } from '../domain/updates/update-service.ts';
import { parseVersion } from '../domain/updates/version.ts';
import { Ed25519Verifier } from '../platform/updates/ed25519-verifier.ts';
import { JsonFeedStateStore } from '../platform/updates/feed-state.ts';
import { detectInstallType, updateFormat } from '../platform/updates/install-type.ts';
import { NetFeedFetcher } from '../platform/updates/net-feed-fetcher.ts';
import { brand } from '../shared/brand.ts';
import { updateKeys } from '../shared/update-keys.ts';

/** What the update service needs from the composition root. */
export interface UpdateDependencies {
  readonly policies: PolicyService;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly userData: string;
}

/**
 * Creates the update service from policies and the installation. electron-updater is
 * imported only when the first check runs, so it never adds to the start-up time.
 * @param deps - Policies, clock, logger and the profile folder.
 */
export function createUpdateService(deps: UpdateDependencies): UpdateService {
  const { policies, clock, logger } = deps;
  const installType = detectInstallType({
    platform: process.platform,
    packaged: app.isPackaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    env: process.env,
  });
  const currentVersion = app.getVersion();
  const isPrerelease = (parseVersion(currentVersion)?.prerelease.length ?? 0) > 0;
  const mirror = policies.mandatoryValue(UpdateURL);
  // Relative feed paths resolve against the root, which therefore ends with a slash.
  const feedBase = new URL((mirror ?? brand.website).replace(/\/?$/, '/'));
  const versionPrefix = policies.mandatoryValue(TargetVersionPrefix);
  const verifier = new Ed25519Verifier(updateKeys);
  const feed = new SignedFeed(
    new NetFeedFetcher(feedBase),
    verifier,
    new JsonFeedStateStore(join(deps.userData, 'update-state.json')),
    () => clock.wallTime(),
  );
  const query = {
    channel: policies.mandatoryValue(TargetChannel) ?? (isPrerelease ? 'beta' : 'stable'),
    currentVersion,
    artifactKey: `${process.platform}-${process.arch}-${updateFormat(installType) ?? 'none'}`,
    ...(versionPrefix === undefined ? {} : { versionPrefix }),
  } as const;

  let engine: UpdateEngine | undefined;
  const load = async (): Promise<UpdateEngine> => {
    const module = await import('../platform/updates/electron-updater-engine.ts');
    engine ??= module.createElectronUpdaterEngine({ feed, query, feedBase, logger });
    return engine;
  };
  const lazyEngine: UpdateEngine = {
    check: async () => (await load()).check(),
    download: async (onProgress) => (await load()).download(onProgress),
    install: () => engine?.install(),
  };

  const service = new UpdateService(lazyEngine, clock, logger.child('updates'), {
    mode: updateMode(policies.mandatoryValue(UpdatePolicy)),
    installType,
    hasKeys: verifier.hasKeys,
    periodMinutes:
      policies.mandatoryValue(AutoUpdateCheckPeriodMinutes) ?? defaultCheckPeriodMinutes,
    isOnline: () => net.isOnline(),
  });
  logger.info('Update service', {
    installType,
    state: service.state.kind,
    channel: query.channel,
    feed: feedBase.href,
  });
  return service;
}
