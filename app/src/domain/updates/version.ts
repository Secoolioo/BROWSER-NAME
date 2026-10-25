/** A semantic version, such as `0.1.0` or `0.1.0-beta.2`. */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Prerelease identifiers, such as `['beta', 2]`; empty for a release. */
  readonly prerelease: readonly (string | number)[];
}

const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parses a semantic version. Build metadata is accepted and ignored.
 * @param text - Version text.
 * @returns The version, or `undefined` when the text is not a semantic version.
 */
export function parseVersion(text: string): Version | undefined {
  const match = versionPattern.exec(text);
  if (match === null) return undefined;
  const prerelease = (match[4] ?? '')
    .split('.')
    .filter((part) => part !== '')
    .map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part));
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

/**
 * Whether a text is a semantic version.
 * @param text - Version text.
 */
export function isVersion(text: string): boolean {
  return parseVersion(text) !== undefined;
}

function compareIdentifiers(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return Math.sign(a - b);
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compares two versions by semantic version precedence, so `0.1.0-beta.2` sorts before
 * `0.1.0`.
 * @param a - First version.
 * @param b - Second version.
 * @returns A negative number, zero or a positive number.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === undefined || right === undefined) {
    throw new RangeError(`Not a semantic version: ${left === undefined ? a : b}`);
  }
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return Math.sign(left[key] - right[key]);
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length);
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const order = compareIdentifiers(l, r);
    if (order !== 0) return order;
  }
  return 0;
}

/**
 * Whether a version matches a version prefix, as set by the `TargetVersionPrefix` policy.
 * A prefix covers whole components: `0.1` matches `0.1.4` but not `0.10.0`.
 * @param version - The version.
 * @param prefix - The prefix, such as `0.1` or `0.1.`.
 */
export function matchesVersionPrefix(version: string, prefix: string): boolean {
  if (prefix === '' || version === prefix) return true;
  const base = prefix.endsWith('.') ? prefix : `${prefix}.`;
  return version.startsWith(base) || version.startsWith(`${prefix}-`);
}
