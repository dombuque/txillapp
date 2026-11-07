// Service worker da app Txillapp (React Native, versão web).
// O nome da cache leva a versão da build (posta pelo post-export-web.mjs): cada versão nova é um service worker novo,
// que ao ativar-se apaga as caches antigas e toma conta das janelas; o register-sw.js recarrega uma vez nessa altura.
//  - páginas: primeiro a rede (a versão nova chega logo); sem rede, a última que se abriu;
//  - ficheiros com hash (/_expo/static, /assets) e ícones: cache primeiro;
//  - a API nunca vai para a cache (pode ser privada).
// As notificações push vêm do push-sw.js (as subscrições que já existem continuam a funcionar).
importScripts('/push-sw.js');

const CACHE = 'txill-app-__TX_BUILD__';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/index.html')).catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(async () => (await caches.match('/index.html')) || Response.error()),
    );
    return;
  }

  if (/^\/(_expo\/static|assets)\//.test(url.pathname) || /\.(png|svg|ico|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
  }
});
