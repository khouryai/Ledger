/* Generated at build time. Precache the app shell so the window opens instantly with no network. */
const VERSION = 'mvpyjjwn';
const CACHE = `ledger-${VERSION}`;
const PRECACHE = ["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png","assets/archivo-latin-wght-normal-E0tuGl4L.woff2","assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2","assets/ibm-plex-mono-latin-600-normal-BgSNZQsw.woff2","assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2","assets/index-DXRBkNIK.css","assets/Recurring-BDdiEQzh.js","assets/People-WfQNnRZx.js","assets/Meetings-C26ErSJE.js","assets/Capture-B51DRoR1.js","assets/Review-CeD7j0Mm.js","assets/Outlook-BjsDbuoY.js","assets/email-B9iO9obq.js","assets/Settings-BKbdFgJ3.js","assets/xlsx-DDU9BE2N.js","assets/fakeApi-N3_Iw0PS.js","assets/fake-BtlfeWrw.js","assets/webllm-DJKOi-jC.js","assets/index-BI-C95S3.js","assets/msg-C7tscPRt.js"];
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
