import { Translator, pickLanguage, type Catalogs } from '../../shared/i18n/i18n.ts';
import de from './de.json' with { type: 'json' };
import en from './en.json' with { type: 'json' };
import macosEn from './macos/en.json' with { type: 'json' };

/** A message key of the browser process; the English catalog defines the set of keys. */
export type MessageKey = keyof typeof en;

/**
 * Catalogs of the texts that the browser process shows itself, such as native menus. The
 * UI's texts live in `ui/i18n/`; each side loads only its own, and both ship the same
 * languages. Menu texts mark their access key for Windows and Linux with `&`.
 */
export const catalogs: Catalogs<MessageKey> = { en, de };

/**
 * The catalogs on macOS, whose menus write English in title case, such as Select All, and
 * hide access keys. German has no title case and keeps its catalog.
 */
const macosCatalogs: Catalogs<MessageKey> = { ...catalogs, en: macosEn };

/**
 * Creates the translator for the application locale. Chromium derives that locale from the
 * system language and reports it to every view as `navigator.languages`, so the browser
 * process speaks the same language as the shell.
 * @param locale - The application locale, `app.getLocale()`.
 * @param platform - `process.platform`; macOS gets its own English texts.
 */
export function translatorFor(locale: string, platform: string): Translator<MessageKey> {
  const shipped = platform === 'darwin' ? macosCatalogs : catalogs;
  return new Translator(shipped, pickLanguage([locale], Object.keys(shipped)));
}
