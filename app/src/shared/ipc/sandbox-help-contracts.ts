import * as v from 'valibot';
import { defineRequest } from './contract.ts';

/** Installs the AppArmor profile through `pkexec` and restarts the browser. */
export const InstallSandboxFix = defineRequest({
  channel: 'sandboxHelp.installFix',
  request: v.strictObject({}),
  response: v.strictObject({ ok: v.boolean() }),
  capability: 'page:sandbox-help',
});

/** Opens the download page for the deb and rpm packages in the system browser. */
export const OpenPackagesPage = defineRequest({
  channel: 'sandboxHelp.openPackages',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'page:sandbox-help',
});
