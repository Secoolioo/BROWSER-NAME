import { nativeTheme } from 'electron';

/**
 * The window color that shows until the shell has painted: `--surface-0` of the UI tokens
 * in the system's light or dark mode, so a window never flashes in the other mode.
 */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#14161a' : '#f5f7f9';
}
