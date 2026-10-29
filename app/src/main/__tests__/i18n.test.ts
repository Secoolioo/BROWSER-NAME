import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogProblems } from '../../shared/__tests__/catalog-problems.ts';
import en from '../i18n/en.json' with { type: 'json' };
import macosEn from '../i18n/macos/en.json' with { type: 'json' };
import { catalogs, translatorFor } from '../i18n/i18n.ts';

/** The languages that have a catalog in a folder of `app/src`, such as `ui/i18n`. */
function languagesIn(folder: string): string[] {
  return readdirSync(new URL(`../../${folder}/`, import.meta.url))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .toSorted();
}

describe('browser process i18n', () => {
  it('has every key in every shipped language, no orphans and the same placeholders', () => {
    expect(catalogProblems(catalogs)).toEqual([]);
    expect(catalogProblems({ en, 'en on macOS': macosEn })).toEqual([]);
  });

  it('ships the languages of the UI, so its menus speak the language of the shell', () => {
    const languages = languagesIn('ui/i18n');
    expect(languagesIn('main/i18n')).toEqual(languages);
    expect(Object.keys(catalogs).toSorted()).toEqual(languages);
  });

  it('follows the application locale and falls back to English', () => {
    expect(translatorFor('de', 'linux').t('contextMenu.back')).toBe('&Zurück');
    expect(translatorFor('de-AT', 'win32').language).toBe('de');
    expect(
      translatorFor('en-US', 'linux').t('contextMenu.searchFor', {
        engine: 'example.org',
        query: 'x',
      }),
    ).toBe('&Search example.org for “x”');
    expect(translatorFor('fr', 'linux').language).toBe('en');
  });

  it('writes English in title case on macOS and keeps German', () => {
    expect(translatorFor('en-GB', 'darwin').t('contextMenu.selectAll')).toBe('Select All');
    expect(translatorFor('fr', 'darwin').t('contextMenu.openLinkInNewTab')).toBe(
      'Open Link in New Tab',
    );
    expect(translatorFor('de', 'darwin').t('contextMenu.selectAll')).toBe('Alles a&uswählen');
  });
});
