import { describe, expect, it } from 'vitest';
import { Translator, pickLanguage } from '../i18n/i18n.ts';
import { catalogProblems } from './catalog-problems.ts';

const catalogs = {
  en: { greeting: 'Hello {name}', bye: 'Bye' },
  de: { greeting: 'Hallo {name}', bye: '' },
};

describe('pickLanguage', () => {
  it('picks the first shipped language and falls back to English', () => {
    expect(pickLanguage(['fr-FR', 'de-AT', 'en'], ['en', 'de'])).toBe('de');
    expect(pickLanguage(['de_DE'], ['en', 'de'])).toBe('de');
    expect(pickLanguage(['fr', 'constructor'], ['en', 'de'])).toBe('en');
    expect(pickLanguage([], ['en', 'de'])).toBe('en');
  });
});

describe('Translator', () => {
  it('fills in placeholders and falls back to English for empty messages', () => {
    const german = new Translator(catalogs, 'de');
    expect(german.language).toBe('de');
    expect(german.t('greeting', { name: 'Ada' })).toBe('Hallo Ada');
    expect(german.t('greeting')).toBe('Hallo {name}');
    expect(german.t('bye')).toBe('Bye');
  });

  it('uses English for languages without a catalog', () => {
    for (const language of ['xx', 'toString']) {
      const translator = new Translator(catalogs, language);
      expect(translator.language).toBe('en');
      expect(translator.t('greeting', { name: 'Ada' })).toBe('Hello Ada');
    }
  });
});

describe('catalogProblems', () => {
  it('reports missing, extra and empty messages and differing placeholders', () => {
    expect(
      catalogProblems({
        en: { a: 'A {x}', b: 'B', c: 'C {y} {y}' },
        de: { a: 'A', b: '', c: 'C {y}', d: 'D' },
        fr: { a: 'A {x}', c: 'C {y}' },
      }),
    ).toEqual([
      'de: a has other placeholders than in English',
      'de: b is empty',
      'de: d is not in English',
      'fr: b is missing',
    ]);
  });

  it('accepts complete catalogs, whatever the order of the placeholders', () => {
    expect(catalogProblems({ en: { a: '{x} of {y}' }, de: { a: '{y}: {x}' } })).toEqual([]);
  });
});
