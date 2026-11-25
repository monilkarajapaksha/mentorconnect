/**
 * Cloudflare Pages Function: forwards every /api/* request to the API Worker through a
 * service binding (`API`, configured in apps/web/wrangler.toml). The browser only ever talks
 * to the Pages domain, so the session cookie is first-party and no CORS is needed.
 */
interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = (context) => context.env.API.fetch(context.request);
