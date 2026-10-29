/** The messages of one language, by key. A message may contain `{name}` placeholders. */
export type Catalog<K extends string> = Readonly<Record<K, string>>;

/**
 * The catalogs of one part of the browser, one per shipped language. English is the
 * source: it defines the keys and stands in for a message that is empty in a translation.
 */
export type Catalogs<K extends string> = Readonly<Record<string, Catalog<K>>> & {
  readonly en: Catalog<K>;
};

/**
 * Picks the best shipped language for a list of preferred languages.
 * @param preferred - Languages in order of preference, such as `navigator.languages`.
 * @param shipped - The languages that have a catalog.
 * @returns A shipped language; English when nothing matches.
 */
export function pickLanguage(preferred: readonly string[], shipped: Iterable<string>): string {
  const available = new Set(shipped);
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0] ?? '';
    if (available.has(base)) {
      return base;
    }
  }
  return 'en';
}

/** Translates message keys for one language, falling back to English. */
export class Translator<K extends string> {
  /** The language of the messages; English when the requested one is not shipped. */
  readonly language: string;
  private readonly catalog: Catalog<K>;
  private readonly source: Catalog<K>;

  /**
   * @param catalogs - The catalogs of every shipped language.
   * @param language - A shipped language.
   */
  constructor(catalogs: Catalogs<K>, language: string) {
    const catalog = Object.hasOwn(catalogs, language) ? catalogs[language] : undefined;
    this.language = catalog === undefined ? 'en' : language;
    this.catalog = catalog ?? catalogs.en;
    this.source = catalogs.en;
  }

  /**
   * Returns the message for a key.
   * @param key - The message key.
   * @param params - Values for `{name}` placeholders.
   */
  t(key: K, params: Readonly<Record<string, string>> = {}): string {
    const message = this.catalog[key] || this.source[key];
    return message.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
  }
}
