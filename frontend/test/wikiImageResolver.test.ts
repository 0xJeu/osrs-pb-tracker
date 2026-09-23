import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWikiImageResolver } from '../src/lib/wikiImageResolver';

const DAY_MS = 24 * 60 * 60 * 1000;
const storageKeyFor = (cacheKey: string) => `pbt:wiki-images:${cacheKey}:v1`;

type Entry = { url: string; ts: number };

function seed(cacheKey: string, entries: Record<string, Entry>) {
  window.localStorage.setItem(storageKeyFor(cacheKey), JSON.stringify(entries));
}

function stored(cacheKey: string): Record<string, Entry> {
  return JSON.parse(window.localStorage.getItem(storageKeyFor(cacheKey)) ?? '{}');
}

/** A MediaWiki imageinfo response resolving each file to a predictable thumb URL. */
function imageinfoResponse(files: string[]) {
  const pages: Record<string, unknown> = {};
  files.forEach((file, i) => {
    pages[String(-(i + 1))] = {
      title: `File:${file}`,
      imageinfo: [{ thumburl: `https://thumb.example/128px-${file}` }],
    };
  });
  return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
}

describe('createWikiImageResolver', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serves an unexpired persisted entry without touching the network', () => {
    seed('fresh', { 'A.png': { url: 'https://thumb.example/A', ts: Date.now() - DAY_MS } });

    const resolver = createWikiImageResolver('fresh');
    resolver.request('A.png');

    expect(resolver.resolvedCache.get('A.png')).toBe('https://thumb.example/A');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a persisted entry older than the 30-day TTL and re-resolves it', async () => {
    seed('expired', { 'A.png': { url: 'https://thumb.example/stale-A', ts: Date.now() - 31 * DAY_MS } });
    fetchMock.mockResolvedValue(imageinfoResponse(['A.png']));

    const resolver = createWikiImageResolver('expired');
    expect(resolver.resolvedCache.has('A.png')).toBe(false);

    resolver.request('A.png');
    await vi.waitFor(() => expect(resolver.resolvedCache.get('A.png')).toBe('https://thumb.example/128px-A.png'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps each entry\'s own resolution time instead of resetting every clock on each write', async () => {
    // Regression: persist() used to stamp every entry with `now`, so resolving any
    // new icon silently renewed all the old ones and the TTL never expired for a
    // returning visitor. A stale thumb URL (the wiki re-uploaded the file) would then
    // render as a broken image indefinitely - the exact case the TTL exists to bound.
    const oldTs = Date.now() - 29 * DAY_MS;
    seed('sliding', { 'A.png': { url: 'https://thumb.example/A', ts: oldTs } });
    fetchMock.mockResolvedValue(imageinfoResponse(['B.png']));

    const resolver = createWikiImageResolver('sliding');
    resolver.request('B.png');
    await vi.waitFor(() => expect(stored('sliding')['B.png']).toBeDefined());

    expect(stored('sliding')['A.png'].ts).toBe(oldTs);
    expect(Date.now() - stored('sliding')['B.png'].ts).toBeLessThan(5_000);
  });

  it('does not persist a failed lookup, and does not retry it within the session', async () => {
    fetchMock.mockRejectedValue(new Error('wiki unavailable'));

    const resolver = createWikiImageResolver('failure');
    resolver.request('A.png');
    await vi.waitFor(() => expect(resolver.resolvedCache.get('A.png')).toBeNull());

    // Not written to storage: a transient blip must not cost a visitor their
    // icons for a month.
    expect(stored('failure')['A.png']).toBeUndefined();

    // And not retried against someone else's API on our users' behalf.
    resolver.request('A.png');
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('batches every file requested in the same tick into one API call at one canonical width', async () => {
    fetchMock.mockResolvedValue(imageinfoResponse(['A.png', 'B.png', 'C.png']));

    const resolver = createWikiImageResolver('batch');
    resolver.request('A.png');
    resolver.request('B.png');
    resolver.request('C.png');
    await vi.waitFor(() => expect(resolver.resolvedCache.size).toBe(3));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('iiurlwidth=128');
    expect(decodeURIComponent(url)).toContain('File:A.png|File:B.png|File:C.png');
  });

  it('keeps working when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    fetchMock.mockResolvedValue(imageinfoResponse(['A.png']));

    const resolver = createWikiImageResolver('blocked');
    resolver.request('A.png');

    await vi.waitFor(() => expect(resolver.resolvedCache.get('A.png')).toBe('https://thumb.example/128px-A.png'));
  });

  it('isolates caches by key so two resolvers never overwrite each other', async () => {
    seed('pets', { 'A.png': { url: 'https://thumb.example/pet-A', ts: Date.now() } });
    fetchMock.mockResolvedValue(imageinfoResponse(['Z.png']));

    const portraits = createWikiImageResolver('portraits');
    portraits.request('Z.png');
    await vi.waitFor(() => expect(stored('portraits')['Z.png']).toBeDefined());

    expect(stored('pets')).toEqual({ 'A.png': { url: 'https://thumb.example/pet-A', ts: expect.any(Number) } });
  });
});
