/**
 * Channel names of the shell, without schemas, so the preload script stays tiny. A test
 * checks that this list matches the contracts in `shell-contracts.ts`.
 */
export const shellChannels = [
  'shell.getState',
  'tabs.open',
  'tabs.activate',
  'tabs.close',
  'tabs.reopenClosed',
  'tabs.navigate',
  'tabs.action',
  'shell.setInsets',
] as const;

/** Event channels the shell listens to. */
export const shellEventChannels = ['shell.stateChanged', 'shell.command'] as const;

/** A request channel of the shell. */
export type ShellChannel = (typeof shellChannels)[number];
