/* Generated at build time. Precache the app shell so the window opens instantly with no network. */
const VERSION = '__VERSION__';
const CACHE = `ledger-${VERSION}`;
const PRECACHE = __PRECACHE__;
// Where the app lives: the root on the laptop, /Ledger/ on GitHub Pages.
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL = new URL('index.html', self.registration.scope).href;

/*
 * A new worker installs but does NOT take over on its own. Taking over mid-session
 * would serve the new build's assets to a page still running the old build's code.
 * It waits until the page says go, which the page does after asking the user.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Only this app's own earlier caches are cleared. Everything else in the site's cache
// storage belongs to somebody else: WebLLM keeps the downloaded model in caches named
// webllm/*, and clearing those on every update deleted the model, and broke a download
// that was in progress when an update took over.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ledger-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Navigations always resolve to the shell so the app opens even when the server is down.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(SHELL)));
    return;
  }
  // index.html and sw.js must never be answered from the cache: they are how a new
  // build announces itself. Everything else under assets/ is content-hashed.
  if (url.pathname === SCOPE || url.pathname === `${SCOPE}index.html`) {
    event.respondWith(fetch(req).catch(() => caches.match(SHELL)));
    return;
  }
  // The ledger never passes through here: it lives on another origin (Supabase),
  // and only this site's own files are cached.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  })));
});
