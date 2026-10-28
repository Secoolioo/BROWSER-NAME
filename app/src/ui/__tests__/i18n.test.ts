import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json' with { type: 'json' };
import en from '../i18n/en.json' with { type: 'json' };
import { Translator, catalogs, pickLanguage } from '../i18n/i18n.ts';

describe('i18n', () => {
  it('has every key in every shipped language and no orphans', () => {
    const keys = Object.keys(en).toSorted();
    for (const [language, catalog] of Object.entries(catalogs)) {
      expect([language, ...Object.keys(catalog).toSorted()]).toEqual([language, ...keys]);
      expect(Object.entries(catalog).filter(([, message]) => message === '')).toEqual([]);
    }
    expect(Object.keys(de).toSorted()).toEqual(keys);
  });

  it('picks the first shipped language and falls back to English', () => {
    expect(pickLanguage(['fr-FR', 'de-AT', 'en'])).toBe('de');
    expect(pickLanguage(['fr'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });

  it('translates and falls back for unknown languages', () => {
    expect(new Translator('de').t('shell.back')).toBe('Zurück');
    const unknown = new Translator('xx');
    expect(unknown.language).toBe('en');
    expect(unknown.t('shell.back')).toBe('Back');
  });
});
