import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import type {
  PolicyProvider,
  PolicyReadError,
  PolicyReadResult,
  PolicyScope,
  RawPolicyValue,
} from '../../domain/policy/policy.ts';
import type { PolicyCache } from '../../domain/policy/policy-service.ts';
import { parsePlist } from './plist.ts';
import { parseRegistryExport, registryPolicies } from './registry-export.ts';

/** Synchronous system access used by the policy providers; replaced by fakes in tests. */
export interface PolicyIo {
  /** Runs a program and waits for it. */
  run(
    command: string,
    args: readonly string[],
  ): { readonly status: number | null; readonly stdout: string };
  /** Reads a file, or returns `undefined` if it does not exist. */
  readFile(path: string): Uint8Array | undefined;
  /** Lists a directory, or returns `undefined` if it does not exist. */
  listDir(path: string): string[] | undefined;
  /** Returns a path for a temporary file. */
  tempFile(name: string): string;
  /** Deletes a file if it exists. */
  remove(path: string): void;
}

/** {@link PolicyIo} backed by Node.js. */
export const nodePolicyIo: PolicyIo = {
  run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return { status: result.status, stdout: result.stdout ?? '' };
  },
  readFile(path) {
    try {
      return readFileSync(path);
    } catch {
      return undefined;
    }
  },
  listDir(path) {
    try {
      return readdirSync(path);
    } catch {
      return undefined;
    }
  },
  tempFile(name) {
    return join(tmpdir(), `${process.pid}-${name}`);
  },
  remove(path) {
    rmSync(path, { force: true });
  },
};

const hives: readonly [string, PolicyScope][] = [
  ['HKLM', 'machine'],
  ['HKCU', 'user'],
];

/**
 * Reads policies from `HKLM` and `HKCU` with `reg export`, which needs no native module.
 * The export is UTF-16LE, so non-ASCII values survive.
 */
export class WindowsRegistryPolicyProvider implements PolicyProvider {
  readonly name = 'windows-registry';
  private readonly io: PolicyIo;
  private readonly root: string;

  /**
   * @param io - System access.
   * @param root - Policy key below the hive, such as `SOFTWARE\Policies\Lampo`.
   */
  constructor(io: PolicyIo, root: string) {
    this.io = io;
    this.root = root;
  }

  /** {@inheritDoc PolicyProvider.load} */
  load(): PolicyReadResult {
    const values: RawPolicyValue[] = [];
    const errors: PolicyReadError[] = [];
    for (const [hive, scope] of hives) {
      const file = this.io.tempFile(`policies-${hive}.reg`);
      try {
        // Exit code 1 means that the key does not exist, which is the normal case.
        const { status } = this.io.run('reg', ['export', `${hive}\\${this.root}`, file, '/y']);
        if (status !== 0) {
          continue;
        }
        const bytes = this.io.readFile(file);
        if (bytes === undefined) {
          errors.push({ source: hive, message: 'The registry export was not written' });
          continue;
        }
        const text = new TextDecoder('utf-16le').decode(bytes);
        const result = registryPolicies(parseRegistryExport(text), this.root, scope);
        values.push(...result.values);
        errors.push(...result.errors);
      } finally {
        this.io.remove(file);
      }
    }
    return { values, errors };
  }
}

/**
 * Reads managed preferences that configuration profiles (MDM) install for the bundle ID.
 * Values in these files are enforced, so they are mandatory policies.
 */
export class MacManagedPreferencesPolicyProvider implements PolicyProvider {
  readonly name = 'macos-managed-preferences';
  private readonly io: PolicyIo;
  private readonly bundleId: string;
  private readonly userName: string;

  /**
   * @param io - System access.
   * @param bundleId - The app's bundle ID.
   * @param userName - Name of the current user, for user-level profiles.
   */
  constructor(io: PolicyIo, bundleId: string, userName: string) {
    this.io = io;
    this.bundleId = bundleId;
    this.userName = userName;
  }

  /** {@inheritDoc PolicyProvider.load} */
  load(): PolicyReadResult {
    const values: RawPolicyValue[] = [];
    const errors: PolicyReadError[] = [];
    const files: readonly [string, PolicyScope][] = [
      [`/Library/Managed Preferences/${this.bundleId}.plist`, 'machine'],
      [`/Library/Managed Preferences/${this.userName}/${this.bundleId}.plist`, 'user'],
    ];
    for (const [path, scope] of files) {
      if (this.io.readFile(path) === undefined) {
        continue;
      }
      // XML instead of JSON, because <date> and <data> values cannot be converted to JSON.
      const { status, stdout } = this.io.run('plutil', ['-convert', 'xml1', '-o', '-', path]);
      if (status !== 0) {
        errors.push({ source: path, message: 'plutil could not read the file' });
        continue;
      }
      try {
        const root = parsePlist(stdout);
        if (
          typeof root !== 'object' ||
          root === null ||
          Array.isArray(root) ||
          root instanceof Date ||
          root instanceof Uint8Array
        ) {
          errors.push({ source: path, message: 'The property list is not a dictionary' });
          continue;
        }
        for (const [name, value] of Object.entries(root)) {
          values.push({ name, value, level: 'mandatory', scope, source: path });
        }
      } catch (error) {
        errors.push({ source: path, message: String(error) });
      }
    }
    return { values, errors };
  }
}

/**
 * Reads JSON files from `<dir>/managed` (mandatory) and `<dir>/recommended`. Files are
 * applied in alphabetical order; a later file overrides an earlier one.
 */
export class LinuxJsonPolicyProvider implements PolicyProvider {
  readonly name = 'linux-json';
  private readonly io: PolicyIo;
  private readonly directory: string;

  /**
   * @param io - System access.
   * @param directory - Policy directory, such as `/etc/lampo/policies`.
   */
  constructor(io: PolicyIo, directory: string) {
    this.io = io;
    this.directory = directory;
  }

  /** {@inheritDoc PolicyProvider.load} */
  load(): PolicyReadResult {
    const values: RawPolicyValue[] = [];
    const errors: PolicyReadError[] = [];
    for (const [folder, level] of [
      ['managed', 'mandatory'],
      ['recommended', 'recommended'],
    ] as const) {
      // Linux paths, also when the tests run on Windows.
      const dir = posix.join(this.directory, folder);
      const merged = new Map<string, RawPolicyValue>();
      for (const file of (this.io.listDir(dir) ?? [])
        .filter((f) => f.endsWith('.json'))
        .toSorted()) {
        const path = posix.join(dir, file);
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(this.io.readFile(path)));
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            errors.push({ source: path, message: 'Expected a JSON object' });
            continue;
          }
          for (const [name, value] of Object.entries(parsed)) {
            merged.set(name, { name, value, level, scope: 'machine', source: path });
          }
        } catch (error) {
          errors.push({ source: path, message: `Invalid JSON: ${String(error)}` });
        }
      }
      values.push(...merged.values());
    }
    return { values, errors };
  }
}

/** Keeps the last successfully read policy values in a JSON file. */
export class JsonFilePolicyCache implements PolicyCache {
  private readonly path: string;

  /** @param path - Cache file, inside the profile directory. */
  constructor(path: string) {
    this.path = path;
  }

  /** {@inheritDoc PolicyCache.read} */
  read(): readonly RawPolicyValue[] | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      return Array.isArray(parsed) && parsed.every(isRawPolicyValue) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** {@inheritDoc PolicyCache.write} */
  write(values: readonly RawPolicyValue[]): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(values));
    } catch {
      // The cache is an optimization; failing to write it must not break startup.
    }
  }
}

function isRawPolicyValue(value: unknown): value is RawPolicyValue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Partial<Record<keyof RawPolicyValue, unknown>>;
  return (
    typeof item.name === 'string' &&
    typeof item.source === 'string' &&
    (item.level === 'mandatory' || item.level === 'recommended') &&
    (item.scope === 'machine' || item.scope === 'user')
  );
}
