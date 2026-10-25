import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InstallType } from '../../domain/updates/update-service.ts';

/** Facts about the running installation. */
export interface InstallFacts {
  readonly platform: NodeJS.Platform;
  readonly packaged: boolean;
  /** The browser executable. */
  readonly execPath: string;
  /** The `resources` folder of the installation. */
  readonly resourcesPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Tells how the browser was installed. A per-machine Windows installation lives under
 * Program Files and is managed by IT; electron-builder marks deb and rpm packages with a
 * `package-type` file; an AppImage runs with the `APPIMAGE` variable set.
 * @param facts - The installation facts.
 */
export function detectInstallType(facts: InstallFacts): InstallType {
  if (!facts.packaged) return 'unpacked';
  if (facts.platform === 'darwin') return 'mac';
  if (facts.platform === 'win32') {
    const exe = facts.execPath.toLowerCase();
    const perMachine = [facts.env['ProgramFiles'], facts.env['ProgramFiles(x86)']].some(
      (dir) => dir !== undefined && dir !== '' && exe.startsWith(`${dir.toLowerCase()}\\`),
    );
    return perMachine ? 'msi' : 'nsis';
  }
  if (facts.env['APPIMAGE'] !== undefined) return 'appimage';
  const marker = join(facts.resourcesPath, 'package-type');
  if (existsSync(marker)) {
    const type = readFileSync(marker, 'utf8').trim();
    if (type === 'deb' || type === 'rpm') return type;
  }
  return 'unpacked';
}

/**
 * The package format that electron-updater downloads for an installation type, as used
 * in the keys of a release manifest.
 * @param type - The installation type.
 */
export function updateFormat(type: InstallType): string | undefined {
  if (type === 'nsis') return 'nsis';
  if (type === 'appimage') return 'appimage';
  if (type === 'mac') return 'zip';
  return undefined;
}
