import type { Context } from 'hono';

/**
 * Redirect semantically equivalent GET URLs before a database query runs.
 * Vercel's cache key includes the path and query string, so casing, duplicate
 * parameters, or ignored tracking parameters would otherwise create fresh
 * origin misses for identical data.
 */
export function redirectToCanonicalGet(c: Context, pathname: string, searchParams?: URLSearchParams) {
  const requestUrl = new URL(c.req.url);
  const search = searchParams && searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  const canonical = `${pathname}${search}`;

  if (requestUrl.pathname !== pathname || requestUrl.search !== search) {
    return c.redirect(canonical, 308);
  }

  return null;
}
