import de from './de.json' with { type: 'json' };
import en from './en.json' with { type: 'json' };

/** A message key; the English catalog defines the set of keys. */
export type MessageKey = keyof typeof en;

/**
 * Tells whether a string is a known message key.
 * @param key - Any string, for example from a `data-i18n` attribute.
 */
export function isMessageKey(key: string | undefined): key is MessageKey {
  return key !== undefined && Object.hasOwn(en, key);
}

/** A message catalog of one language. */
export type Catalog = Readonly<Record<MessageKey, string>>;

/** Catalogs of the shipped languages. A new language only needs a new JSON file here. */
export const catalogs: Readonly<Record<string, Catalog>> = { en, de };

/**
 * Picks the best shipped language for a list of preferred languages.
 * @param preferred - Languages in order of preference, such as `navigator.languages`.
 * @returns A key of {@link catalogs}; English when nothing matches.
 */
export function pickLanguage(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0] ?? '';
    if (base in catalogs) {
      return base;
    }
  }
  return 'en';
}

/** Translates message keys for one language, falling back to English. */
export class Translator {
  readonly language: string;
  private readonly catalog: Catalog;

  /** @param language - A key of {@link catalogs}. */
  constructor(language: string) {
    this.language = language in catalogs ? language : 'en';
    this.catalog = catalogs[this.language] ?? en;
  }

  /**
   * Returns the message for a key.
   * @param key - The message key.
   * @param params - Values for `{name}` placeholders.
   */
  t(key: MessageKey, params: Readonly<Record<string, string>> = {}): string {
    const message = this.catalog[key] || en[key];
    return message.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
  }
}
