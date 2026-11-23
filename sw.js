/* Simple Write service worker: lets the app install and run with no Internet.
   Strategy: the app files are stored on the first visit. After that each file is requested from the network first
   (so a changed source is picked up on the next load) and the stored copy is used when the network is missing or slow.
   Bump VERSION when you want the stored set rebuilt from scratch (any change to this file does that too). */
const VERSION = 'sw-2026-11-22c';
const CACHE = 'simple-write-' + VERSION;
const FILES = [
  "./",
  "css/style.css",
  "favicon.svg",
  "help.html",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "index.html",
  "js/ai.js",
  "js/app.js",
  "js/bib.js",
  "js/csv.js",
  "js/dialogs.js",
  "js/dictate.js",
  "js/docx.js",
  "js/docxread.js",
  "js/editor.js",
  "js/files.js",
  "js/headfoot.js",
  "js/paginate.js",
  "js/import.js",
  "js/layout.js",
  "js/media.js",
  "js/picture.js",
  "js/present.js",
  "js/render.js",
  "js/shapes.js",
  "js/sorter.js",
  "js/tomd.js",
  "js/util.js",
  "lib/highlight.min.js",
  "lib/hljs-github-dark.css",
  "lib/hljs-github.css",
  "lib/jszip.min.js",
  "lib/katex/fonts/KaTeX_AMS-Regular.woff2",
  "lib/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
  "lib/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
  "lib/katex/fonts/KaTeX_Fraktur-Bold.woff2",
  "lib/katex/fonts/KaTeX_Fraktur-Regular.woff2",
  "lib/katex/fonts/KaTeX_Main-Bold.woff2",
  "lib/katex/fonts/KaTeX_Main-BoldItalic.woff2",
  "lib/katex/fonts/KaTeX_Main-Italic.woff2",
  "lib/katex/fonts/KaTeX_Main-Regular.woff2",
  "lib/katex/fonts/KaTeX_Math-BoldItalic.woff2",
  "lib/katex/fonts/KaTeX_Math-Italic.woff2",
  "lib/katex/fonts/KaTeX_SansSerif-Bold.woff2",
  "lib/katex/fonts/KaTeX_SansSerif-Italic.woff2",
  "lib/katex/fonts/KaTeX_SansSerif-Regular.woff2",
  "lib/katex/fonts/KaTeX_Script-Regular.woff2",
  "lib/katex/fonts/KaTeX_Size1-Regular.woff2",
  "lib/katex/fonts/KaTeX_Size2-Regular.woff2",
  "lib/katex/fonts/KaTeX_Size3-Regular.woff2",
  "lib/katex/fonts/KaTeX_Size4-Regular.woff2",
  "lib/katex/fonts/KaTeX_Typewriter-Regular.woff2",
  "lib/katex/katex.min.css",
  "lib/katex/katex.min.js",
  "lib/marked.min.js",
  "lib/purify.min.js",
  "lib/turndown.js",
  "manifest.webmanifest"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('simple-write-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;           // other sites (AI providers, fonts) go straight to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const stored = () => cache.match(r, { ignoreSearch: true });
    try {
      const net = await Promise.race([fetch(r, { cache: 'no-cache' }), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
      if (net && net.ok && net.status === 200) cache.put(r, net.clone());
      return net;
    } catch (_) {
      const hit = await stored();
      if (hit) return hit;
      if (r.mode === 'navigate') { const home = await cache.match('index.html'); if (home) return home; }
      return fetch(r, { cache: 'no-cache' });                                                          // slow but not stored: wait for the network after all
    }
  })());
});
