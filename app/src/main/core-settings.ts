import * as v from 'valibot';
import { defineSetting } from '../domain/settings/setting.ts';

/**
 * Search URL used by the address bar, with `%s` for the query. The default engine is a
 * plain search URL; no partnership or tracking parameter is involved.
 */
export const SearchUrlTemplate = defineSetting({
  key: 'search.urlTemplate',
  schema: v.pipe(v.string(), v.regex(/^https:\/\/[^\s]+%s[^\s]*$/, 'Must be an https URL with %s')),
  default: 'https://duckduckgo.com/?q=%s',
  scope: 'global',
  policy: { name: 'DefaultSearchProviderSearchURL', sensitive: true },
  ui: { section: 'search', control: 'text' },
});

/** Settings that exist before any feature module contributes its own. */
export const coreSettings = [SearchUrlTemplate];
