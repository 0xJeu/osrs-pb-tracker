import type { Context } from 'hono';

/**
 * Redirect semantically equivalent GET URLs before a database query runs.
 * Vercel's cache key includes the query string, so duplicate parameters or
 * ignored tracking parameters would otherwise create fresh origin misses for
 * identical data. Function routers can rewrite the pathname before invoking
 * the app, so frontend request generation owns path canonicalization.
 */
export function redirectToCanonicalGet(c: Context, pathname: string, searchParams?: URLSearchParams) {
  const requestUrl = new URL(c.req.url);
  const search = searchParams && searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  const canonical = `${pathname}${search}`;
  if (requestUrl.search !== search) {
    return c.redirect(canonical, 308);
  }

  return null;
}
