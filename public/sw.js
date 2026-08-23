// Тундук — Service Worker
// Версия номерин ар бир жаңы деплойдо өзгөртүү керек (мис. v2, v3...),
// ошондо эски кэш автоматтык түрдө өчүп, жаңы файлдар жүктөлөт.
const CACHE_VERSION = "tunduk-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Статикалык (сейрек өзгөргөн) ресурстар — сүрөттөр, иконкалар
const STATIC_ASSETS = [
  "./tunduk-logo.png",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  // Жаңы service worker дароо активдешсин, эскисин күтпөй
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Кээ бир файл табылбаса да, орнотуу үзгүлтүккө учурабасын
      });
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Эски версиядагы бардык кэштерди өчүрөбүз
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith("tunduk-") && !name.startsWith(CACHE_VERSION))
          .map((name) => caches.delete(name))
      );
      // Бул service worker дароо бардык ачык барактарды башкарсын
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Башка домендерге (API чакыруулар, Gemini ж.б.) тийбейбиз
  if (url.origin !== self.location.origin) return;

  // HTML жана JS файлдар: НЕТВОРК-БИРИНЧИ — дайыма серверден жаңысын
  // алууга аракет кыл, интернет жок болгондо гана кэштен бер.
  // Бул жаңы деплойлор дароо көрүнүшүн камсыз кылат.
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith(".js") || url.pathname === "/") {
    event.respondWith(
      fetch(req)
        .then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, clone));
          return response;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Сүрөттөр жана башка статика: кэш-биринчи, тезирээк жүктөлсүн
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        const clone = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(req, clone));
        return response;
      });
    })
  );
});
