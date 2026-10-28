/** What the address bar should do with the user's input. */
export type OmniboxTarget =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'search'; readonly url: string; readonly query: string };

/** Schemes the address bar opens directly. Everything else is treated as a search. */
const navigableSchemes = new Set(['http:', 'https:', 'about:', 'app:']);

const hostPattern =
  /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d{1,5})?(?:[/?#].*)?$/i;

/** Hosts that are reached over plain HTTP by default, because they rarely have certificates. */
const localHostPattern =
  /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d+)?(?:[/?#]|$)/i;

/**
 * Decides whether address bar input is a URL or a search, and builds the URL to open.
 * Hosts without a scheme get `https://`, except local hosts and IP addresses, which get
 * `http://`. The web view normalizes the URL when it loads it.
 * @param input - What the user typed.
 * @param searchTemplate - Search URL with `%s` for the encoded query.
 * @returns The target, or `undefined` for blank input.
 */
export function resolveOmniboxInput(
  input: string,
  searchTemplate: string,
): OmniboxTarget | undefined {
  const text = input.trim();
  if (text === '') {
    return undefined;
  }
  const schemeMatch = /^([a-z][a-z0-9+.-]*:)/i.exec(text);
  if (schemeMatch?.[1] !== undefined && !/^[^\s:]+:\d/.test(text)) {
    const scheme = schemeMatch[1].toLowerCase();
    return navigableSchemes.has(scheme) && !/\s/.test(text)
      ? { kind: 'url', url: text }
      : search(text, searchTemplate);
  }
  if (!/\s/.test(text) && hostPattern.test(text)) {
    const scheme = localHostPattern.test(text) ? 'http' : 'https';
    return { kind: 'url', url: `${scheme}://${text}` };
  }
  return search(text, searchTemplate);
}

function search(query: string, template: string): OmniboxTarget {
  return { kind: 'search', query, url: template.replace('%s', encodeURIComponent(query)) };
}
