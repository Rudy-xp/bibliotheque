const C = "biblio-v8";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png"];
const CDN = /(unpkg\.com|cdn\.jsdelivr\.net|covers\.openlibrary\.org|books\.google\.com|fonts\.(googleapis|gstatic)\.com)$/;
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  const store = res => { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); return res; };
  if (u.origin === location.origin) {
    e.respondWith(fetch(r).then(store).catch(() => caches.match(r).then(m => m || caches.match("./index.html"))));
  } else if (CDN.test(u.hostname)) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(store)));
  }
});
