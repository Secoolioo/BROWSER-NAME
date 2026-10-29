/**
 * Lists what keeps message catalogs from being complete: keys that a language lacks, keys
 * that English does not have, empty messages and placeholders that differ from English.
 * The i18n test of every set of catalogs expects an empty list.
 * @param catalogs - Catalogs by language; English is the source.
 */
export function catalogProblems(
  catalogs: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string[] {
  const source = catalogs['en'] ?? {};
  const problems: string[] = [];
  for (const [language, catalog] of Object.entries(catalogs)) {
    for (const key of Object.keys(source)) {
      if (!Object.hasOwn(catalog, key)) {
        problems.push(`${language}: ${key} is missing`);
      }
    }
    for (const [key, message] of Object.entries(catalog)) {
      const english = source[key];
      if (english === undefined) {
        problems.push(`${language}: ${key} is not in English`);
      } else if (message === '') {
        problems.push(`${language}: ${key} is empty`);
      } else if (placeholders(message) !== placeholders(english)) {
        problems.push(`${language}: ${key} has other placeholders than in English`);
      }
    }
  }
  return problems;
}

function placeholders(message: string): string {
  return [...new Set(message.match(/\{\w+\}/g))].toSorted().join(' ');
}
