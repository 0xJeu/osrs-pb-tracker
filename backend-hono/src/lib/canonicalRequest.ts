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
  // Vercel's filesystem router may append a trailing slash to req.url after
  // matching a function even when the visitor requested the slashless URL.
  // Treat that internal rewrite as equivalent or we redirect the public URL
  // back to itself forever.
  const requestPathname =
    requestUrl.pathname.length > 1 ? requestUrl.pathname.replace(/\/+$/, '') : requestUrl.pathname;

  // The serverless filesystem router can also rewrite the pathname to its
  // matched function path. On Vercel, the frontend is responsible for path
  // canonicalization; only compare the query string that reaches this app.
  const pathIsCanonical = Boolean(process.env.VERCEL) || requestPathname === pathname;

  if (!pathIsCanonical || requestUrl.search !== search) {
    return c.redirect(canonical, 308);
  }

  return null;
}
