/**
 * Tells whether a URL that comes from a web page may open in a new tab, whether the page
 * asked for a window or the user picked a link in its context menu. Only http and https
 * qualify: internal `app://` pages, local files and `data:`, `blob:` or `javascript:`
 * URLs never open on behalf of a page.
 * @param url - The URL from the page.
 */
export function mayOpenInNewTab(url: string): boolean {
  return /^https?:/i.test(url);
}
