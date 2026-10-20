/**
 * Where the hosted app's backend is. Compiled in from cloud.json by the GitHub Pages
 * build (`npm run build:pages`); empty in the laptop build, which then keeps the
 * ledger in a folder exactly as before and never loads the Supabase client.
 *
 * The key is Supabase's publishable (anon) key. It is public by design: it says
 * which project, and grants nothing that row-level security does not.
 */
export type CloudConfig = { url: string; key: string };

declare const __CLOUD__: CloudConfig | null;

export function cloudConfig(): CloudConfig | null {
  const c = typeof __CLOUD__ === 'undefined' ? null : __CLOUD__;
  return c && c.url && c.key ? c : null;
}

/** The test hook: `?cloud=fake` runs the hosted flow against the in-memory backend. */
export function fakeCloudRequested(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('cloud') === 'fake';
}
