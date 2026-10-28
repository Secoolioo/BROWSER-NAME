import { net } from 'electron';
import { FeedError, type FeedFetcher } from '../../domain/updates/feed.ts';

/**
 * Loads feed files through Chromium's network stack, so system proxies and certificates
 * apply as they do for browsing.
 */
export class NetFeedFetcher implements FeedFetcher {
  private readonly base: URL;

  /** @param base - Root of the feed, such as the website or an organization mirror. */
  constructor(base: URL) {
    this.base = base;
  }

  /** {@inheritDoc FeedFetcher.fetch} */
  async fetch(path: string): Promise<string | undefined> {
    const url = new URL(path, this.base);
    const response = await net.fetch(url.href, { cache: 'no-store', redirect: 'follow' });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new FeedError('unavailable', `${url.href} answered ${response.status}`);
    }
    return response.text();
  }
}
