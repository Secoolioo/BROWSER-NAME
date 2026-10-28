import { app } from 'electron';
import { join } from 'node:path';
import type { Logger } from '../kernel/logging/logger.ts';
import { BootGuard, type BootDecision } from '../domain/updates/boot-guard.ts';
import type { InstallType } from '../domain/updates/update-service.ts';
import { JsonBootStateStore } from '../platform/updates/boot-state.ts';
import { detectInstallType } from '../platform/updates/install-type.ts';
import { rollbackFor, updaterDirectory, type Rollback } from '../platform/updates/rollback.ts';
import { brand } from '../shared/brand.ts';

declare const BUILD_TEST_BOOT_FAILURE: boolean;

/** The boot guard and what it decided for this start. */
export interface BootCheck {
  readonly guard: BootGuard;
  readonly decision: BootDecision;
  readonly installType: InstallType;
  /** Keeps and restores the previous version, where the installation type allows it. */
  readonly rollback: Rollback | undefined;
}

/**
 * Runs the boot guard first thing in the main process. After an update failed to start too
 * often, the previous version is restored and started instead.
 * @param logger - Logger.
 * @returns The check, or `undefined` when this process must exit for a rollback.
 */
export function checkBoot(logger: Logger): BootCheck | undefined {
  const installType = detectInstallType({
    platform: process.platform,
    packaged: app.isPackaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    env: process.env,
  });
  const directory = join(updaterDirectory(brand.slug, process.env, process.platform), 'rollback');
  const guard = new BootGuard(new JsonBootStateStore(join(directory, 'boot-state.json')));
  const rollback = rollbackFor(installType, { directory, appImage: process.env['APPIMAGE'] });
  const decision = guard.beginBoot(app.getVersion());
  if (decision.kind === 'rollback') {
    logger.error('The update failed to start; restoring the previous version', undefined, {
      failed: decision.failed,
      previous: decision.previous,
    });
    if (rollback?.restore(process.argv.slice(1)) === true) return undefined;
    logger.error('The previous version could not be restored');
  } else if (decision.kind === 'trial') {
    logger.warn('First starts of an update', { attempt: decision.attempt });
    if (BUILD_TEST_BOOT_FAILURE) {
      // Only test builds for the rollback test set this; it is false in every release.
      throw new Error('Simulated start failure');
    }
  }
  return { guard, decision, installType, rollback };
}
