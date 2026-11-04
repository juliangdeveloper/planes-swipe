const CACHE = "planes-swipe-v0.8.13";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css?v=0.8.13",
  "./js/config.js",
  "./js/format.js",
  "./js/sheet.js",
  "./js/queue.js",
  "./js/script.js",
  "./js/meta.js",
  "./js/progress.js",
  "./js/app.js?v=0.8.13",
  "./favicon.svg",
  "./manifest.json?v=0.8.13",
  "./downloads/plantilla-eventos.xlsx",
  "./downloads/Code.gs",
  "./downloads/conectar-ia-prompt.md",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("./index.html"))),
  );
});
