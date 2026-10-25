/** A value of an XML property list. */
export type PlistValue =
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | readonly PlistValue[]
  | { readonly [key: string]: PlistValue };

/** Thrown for malformed property lists. */
export class PlistError extends Error {
  override readonly name = 'PlistError';
}

/**
 * Parses an XML property list, as produced by `plutil -convert xml1`. Supports `dict`,
 * `array`, `string`, `integer`, `real`, `true`, `false`, `date` and `data`.
 * @param xml - The document.
 * @returns The root value.
 * @throws PlistError when the document is malformed.
 */
export function parsePlist(xml: string): PlistValue {
  const tokens = tokenize(xml);
  let index = tokens.findIndex((t) => t.kind === 'open' && t.name === 'plist');
  if (index === -1) {
    throw new PlistError('Missing <plist> element');
  }
  index += 1;
  const [value, next] = parseValue(tokens, index);
  if (tokens[next]?.kind !== 'close' || tokens[next].name !== 'plist') {
    throw new PlistError('Expected </plist>');
  }
  return value;
}

interface Token {
  readonly kind: 'open' | 'close' | 'empty' | 'text';
  readonly name: string;
}

function tokenize(xml: string): Token[] {
  const body = xml.replace(/<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, '');
  const tokens: Token[] = [];
  const pattern = /<(\/?)([A-Za-z0-9]+)[^>]*?(\/?)>|([^<]+)/g;
  for (const match of body.matchAll(pattern)) {
    if (match[4] !== undefined) {
      if (match[4].trim() !== '') {
        tokens.push({ kind: 'text', name: decodeEntities(match[4]) });
      }
    } else if (match[2] !== undefined) {
      const kind = match[1] === '/' ? 'close' : match[3] === '/' ? 'empty' : 'open';
      tokens.push({ kind, name: match[2] });
    }
  }
  return tokens;
}

function decodeEntities(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_, entity: string) => {
    switch (entity) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return String.fromCodePoint(
          entity.startsWith('#x')
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10),
        );
    }
  });
}

function textOf(tokens: readonly Token[], index: number, name: string): [string, number] {
  const token = tokens[index];
  if (token?.kind === 'close' && token.name === name) {
    return ['', index + 1];
  }
  if (token?.kind !== 'text' || tokens[index + 1]?.kind !== 'close') {
    throw new PlistError(`Malformed <${name}>`);
  }
  return [token.name, index + 2];
}

function parseValue(tokens: readonly Token[], index: number): [PlistValue, number] {
  const token = tokens[index];
  if (token === undefined) {
    throw new PlistError('Unexpected end of document');
  }
  if (token.kind === 'empty') {
    switch (token.name) {
      case 'true':
        return [true, index + 1];
      case 'false':
        return [false, index + 1];
      case 'string':
        return ['', index + 1];
      case 'array':
        return [[], index + 1];
      case 'dict':
        return [{}, index + 1];
      default:
        throw new PlistError(`Unsupported <${token.name}/>`);
    }
  }
  if (token.kind !== 'open') {
    throw new PlistError(`Unexpected ${token.kind} ${token.name}`);
  }
  const start = index + 1;
  switch (token.name) {
    case 'string': {
      return textOf(tokens, start, 'string');
    }
    case 'integer':
    case 'real': {
      const [text, next] = textOf(tokens, start, token.name);
      const number = Number(text.trim());
      if (Number.isNaN(number)) {
        throw new PlistError(`Invalid number "${text}"`);
      }
      return [number, next];
    }
    case 'date': {
      const [text, next] = textOf(tokens, start, 'date');
      return [new Date(text.trim()), next];
    }
    case 'data': {
      const [text, next] = textOf(tokens, start, 'data');
      return [Uint8Array.from(atob(text.replace(/\s+/g, '')), (c) => c.charCodeAt(0)), next];
    }
    case 'array': {
      const items: PlistValue[] = [];
      let next = start;
      while (tokens[next]?.kind !== 'close') {
        const [item, after] = parseValue(tokens, next);
        items.push(item);
        next = after;
      }
      return [items, next + 1];
    }
    case 'dict': {
      const entries: [string, PlistValue][] = [];
      let next = start;
      while (tokens[next]?.kind !== 'close') {
        if (tokens[next]?.kind !== 'open' || tokens[next]?.name !== 'key') {
          throw new PlistError('Expected <key> in <dict>');
        }
        const [key, afterKey] = textOf(tokens, next + 1, 'key');
        const [item, after] = parseValue(tokens, afterKey);
        entries.push([key, item]);
        next = after;
      }
      return [Object.fromEntries(entries), next + 1];
    }
    default:
      throw new PlistError(`Unsupported <${token.name}>`);
  }
}
