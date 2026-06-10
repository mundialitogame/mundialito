/* Mundialito service worker: network-first with full runtime cache fallback,
   so the game keeps working offline once it has loaded once. */
const CACHE = "mundialito-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const fresh = await fetch(e.request);
        if (fresh.ok && new URL(e.request.url).origin === location.origin) {
          cache.put(e.request, fresh.clone());
        }
        return fresh;
      } catch {
        const hit = await cache.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        if (e.request.mode === "navigate") {
          const shell = await cache.match("./index.html") || await cache.match("./");
          if (shell) return shell;
        }
        return Response.error();
      }
    })
  );
});
