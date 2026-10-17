const CACHE = "planes-swipe-v0.3.0-quiero";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/format.js",
  "./js/sheet.js",
  "./js/queue.js",
  "./js/script.js",
  "./js/demo.js",
  "./js/app.js",
  "./favicon.svg",
  "./manifest.json",
  "./img/festival.svg",
  "./img/lights.svg",
  "./img/theater.svg",
  "./img/market.svg",
  "./img/arena.svg",
  "./img/park.svg",
  "./img/cinema.svg",
  "./img/books.svg",
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
