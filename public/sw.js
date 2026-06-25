/* ═══════════════════════════════════════════════════
   TREND TV — Service Worker (PWA)
   Estratégia: Cache First para assets estáticos,
               Network First para dados do Firebase
   ═══════════════════════════════════════════════════ */

const CACHE_NAME   = "trendtv-v1";
const SHELL_ASSETS = [
  "/",
  "/tv",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

/* ── Install: pré-cache do shell ── */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_ASSETS).catch(() => {})
    )
  );
  self.skipWaiting();
});

/* ── Activate: limpa caches antigos ── */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ── Fetch: estratégia por tipo de request ── */
self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Firebase / YouTube API → sempre Network (dados ao vivo)
  if (
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("youtube.com") ||
    url.hostname.includes("youtu.be") ||
    url.hostname.includes("img.youtube.com")
  ) {
    e.respondWith(fetch(request).catch(() => new Response("", { status: 503 })));
    return;
  }

  // Navegação (HTML) → Network First, fallback para cache
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match("/") || caches.match(request))
    );
    return;
  }

  // Assets estáticos (JS, CSS, imagens) → Cache First
  if (
    request.destination === "script" ||
    request.destination === "style"  ||
    request.destination === "image"  ||
    request.destination === "font"
  ) {
    e.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            return res;
          })
      )
    );
    return;
  }

  // Resto → Network
  e.respondWith(fetch(request).catch(() => new Response("", { status: 503 })));
});

/* ── Push notifications (futuro) ── */
self.addEventListener("push", (e) => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || "TREND TV", {
      body:    data.body || "Novo programa começando!",
      icon:    "/icons/icon-192.png",
      badge:   "/icons/icon-192.png",
      data:    { url: data.url || "/" },
      actions: [{ action: "watch", title: "▶ Assistir" }],
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(clients.openWindow(url));
});
