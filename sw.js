// Guarda o aplicativo, as cifras, as partituras e os áudios já abertos, para funcionar sem internet.
// Com internet, busca sempre a versão mais nova; sem internet, usa a guardada.
const CACHE = "maemusica-v15";
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./cifra.js", "./firebase-config.js", "./manifest.webmanifest",
  "./data/musicas.json", "./data/config.json", "./data/cursos.json",
  "./assets/fundo.jpg", "./assets/logo-maes.png", "./assets/logo-p.png",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
  SDK + "firebase-app.js", SDK + "firebase-auth.js", SDK + "firebase-firestore.js", SDK + "firebase-storage.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const mine = url.origin === self.location.origin;
  const sdk = url.href.startsWith(SDK);
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!mine && !sdk && !fonts) return; // Firebase e YouTube passam direto
  if (mine && url.pathname.includes("/audio/")) {
    // áudio: depois de ouvido uma vez, toca do aparelho (não gasta internet de novo)
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok && r.status === 200) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    })));
    return;
  }
  if (mine) {
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })));
});
