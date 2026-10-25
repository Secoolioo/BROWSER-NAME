import type {
  PolicyReadError,
  PolicyReadResult,
  PolicyScope,
  RawPolicyValue,
} from '../../domain/policy/policy.ts';

/** A value in a registry key, converted to a plain value. */
export type RegistryValue = string | number | bigint | readonly string[];

/** One key of a `reg export` file with its values. */
export interface RegistryKey {
  /** Full path, such as `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Astela`. */
  readonly path: string;
  readonly values: ReadonlyMap<string, RegistryValue>;
  /** Values of types that policies do not use, such as `REG_BINARY`. */
  readonly unsupported: readonly string[];
}

/**
 * Parses the text of a `reg export` file (format "Windows Registry Editor Version 5.00").
 * Supports strings, `dword`, `hex(b)` (QWORD), `hex(2)` (expandable string) and `hex(7)`
 * (multi-string). Other types are listed as unsupported.
 * @param text - File content, already decoded from UTF-16LE.
 */
export function parseRegistryExport(text: string): RegistryKey[] {
  const keys: { path: string; values: Map<string, RegistryValue>; unsupported: string[] }[] = [];
  const lines = joinContinuations(text.replace(/^﻿/, '').split(/\r?\n/));
  let current: (typeof keys)[number] | undefined;
  for (const line of lines) {
    const header = /^\[(.+)\]$/.exec(line);
    if (header?.[1] !== undefined) {
      current = { path: header[1], values: new Map(), unsupported: [] };
      keys.push(current);
      continue;
    }
    const entry = /^"((?:[^"\\]|\\.)*)"=(.*)$/.exec(line);
    if (current === undefined || entry?.[1] === undefined || entry[2] === undefined) {
      continue;
    }
    const name = unescape(entry[1]);
    const value = parseValue(entry[2]);
    if (value === undefined) {
      current.unsupported.push(name);
    } else {
      current.values.set(name, value);
    }
  }
  return keys;
}

/**
 * Converts the keys below a policy root into raw policy values. Values of the root key are
 * mandatory and values of its `Recommended` subkey are recommended. A subkey named after a
 * policy holds a list, with values named `1`, `2`, ... in order.
 * @param keys - Parsed keys of one hive.
 * @param root - Policy root path inside the hive, such as `SOFTWARE\Policies\Astela`.
 * @param scope - `machine` for HKLM, `user` for HKCU.
 */
export function registryPolicies(
  keys: readonly RegistryKey[],
  root: string,
  scope: PolicyScope,
): PolicyReadResult {
  const values: RawPolicyValue[] = [];
  const errors: PolicyReadError[] = [];
  const hive = scope === 'machine' ? 'HKEY_LOCAL_MACHINE' : 'HKEY_CURRENT_USER';
  const base = `${hive}\\${root}`.toLowerCase();
  for (const key of keys) {
    const path = key.path.toLowerCase();
    if (path !== base && !path.startsWith(`${base}\\`)) {
      continue;
    }
    const parts = key.path.slice(base.length).split('\\').filter(Boolean);
    const recommended = parts[0]?.toLowerCase() === 'recommended';
    const rest = recommended ? parts.slice(1) : parts;
    const level = recommended ? 'recommended' : 'mandatory';
    const source = `${scope === 'machine' ? 'HKLM' : 'HKCU'}\\${key.path.slice(hive.length + 1)}`;
    for (const name of key.unsupported) {
      errors.push({ source, message: `Value ${name} has an unsupported registry type` });
    }
    if (rest.length === 0) {
      for (const [name, value] of key.values) {
        values.push({ name, value: toPlain(value), level, scope, source });
      }
    } else if (rest.length === 1 && rest[0] !== undefined) {
      const list = [...key.values]
        .filter(([name]) => /^\d+$/.test(name))
        .toSorted(([a], [b]) => Number(a) - Number(b))
        .map(([, value]) => toPlain(value));
      values.push({ name: rest[0], value: list, level, scope, source });
    } else {
      errors.push({ source, message: 'Nested policy keys are not supported' });
    }
  }
  return { values, errors };
}

function toPlain(value: RegistryValue): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

function joinContinuations(lines: readonly string[]): string[] {
  const result: string[] = [];
  let pending = '';
  for (const raw of lines) {
    const line = pending === '' ? raw : raw.trimStart();
    if (line.endsWith('\\') && /=hex/.test(pending + line)) {
      pending += line.slice(0, -1);
      continue;
    }
    result.push(pending + line);
    pending = '';
  }
  if (pending !== '') {
    result.push(pending);
  }
  return result;
}

function unescape(text: string): string {
  return text.replace(/\\(.)/g, '$1');
}

function parseValue(data: string): RegistryValue | undefined {
  if (data.startsWith('"') && data.endsWith('"')) {
    return unescape(data.slice(1, -1));
  }
  const dword = /^dword:([0-9a-fA-F]{8})$/.exec(data);
  if (dword?.[1] !== undefined) {
    return Number.parseInt(dword[1], 16);
  }
  const hex = /^hex\((b|2|7)\):([0-9a-fA-F,\s]*)$/.exec(data);
  if (hex?.[1] === undefined || hex[2] === undefined) {
    return undefined;
  }
  const bytes = Uint8Array.from(
    hex[2]
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean)
      .map((b) => Number.parseInt(b, 16)),
  );
  if (hex[1] === 'b') {
    return bytes.length === 8 ? new DataView(bytes.buffer).getBigUint64(0, true) : undefined;
  }
  const text = new TextDecoder('utf-16le').decode(bytes);
  if (hex[1] === '2') {
    return text.replace(/\0+$/, '');
  }
  return text.replace(/\0+$/, '').split('\0');
}
