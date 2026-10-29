import {
  Translator as CatalogTranslator,
  pickLanguage as pickShippedLanguage,
  type Catalogs,
} from '../../shared/i18n/i18n.ts';
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

/** Catalogs of the shipped languages. A new language needs a JSON file here and in `main/i18n/`. */
export const catalogs: Catalogs<MessageKey> = { en, de };

/**
 * Picks the best shipped language for a list of preferred languages.
 * @param preferred - Languages in order of preference, such as `navigator.languages`.
 * @returns A key of {@link catalogs}; English when nothing matches.
 */
export function pickLanguage(preferred: readonly string[]): string {
  return pickShippedLanguage(preferred, Object.keys(catalogs));
}

/** Translates the UI's message keys for one language, falling back to English. */
export class Translator extends CatalogTranslator<MessageKey> {
  /** @param language - A key of {@link catalogs}. */
  constructor(language: string) {
    super(catalogs, language);
  }
}
