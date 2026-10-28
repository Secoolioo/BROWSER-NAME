import { userInfo } from 'node:os';
import type { Brand } from '../../shared/brand.ts';
import type { PolicyProvider } from '../../domain/policy/policy.ts';
import {
  LinuxJsonPolicyProvider,
  MacManagedPreferencesPolicyProvider,
  WindowsRegistryPolicyProvider,
  nodePolicyIo,
  type PolicyIo,
} from './policy-providers.ts';

/**
 * Creates the policy providers of the current platform. Paths follow the enterprise
 * design: `SOFTWARE\Policies\<Product>` on Windows, managed preferences of the bundle id
 * on macOS and `/etc/<slug>/policies` on Linux.
 * @param brand - Product names and identifiers.
 * @param platform - `process.platform`.
 * @param io - System access; defaults to Node.js.
 */
export function createPolicyProviders(
  brand: Brand,
  platform: NodeJS.Platform,
  io: PolicyIo = nodePolicyIo,
): PolicyProvider[] {
  if (platform === 'win32') {
    return [new WindowsRegistryPolicyProvider(io, `SOFTWARE\\Policies\\${brand.productName}`)];
  }
  if (platform === 'darwin') {
    return [new MacManagedPreferencesPolicyProvider(io, brand.appId, safeUserName())];
  }
  return [new LinuxJsonPolicyProvider(io, `/etc/${brand.slug}/policies`)];
}

function safeUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}
