// Notificações push (importado pelo service worker gerado pelo Workbox).
// O ícone grande e o ícone pequeno da barra de estado têm de ser PNG (o Android ignora SVG nas notificações);
// o pequeno é só uma silhueta (o Android pinta-o de uma cor só).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Txillapp', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: data.tag,
      // Mesma conversa/pessoa: a notificação nova substitui a antiga mas volta a avisar (som e vibração).
      renotify: !!data.tag,
      timestamp: Date.now(),
      lang: 'pt',
      data: { url: data.url || '/' },
    }),
  );
});

// Ao tocar: se a app já está aberta, vai para lá; senão abre. Só se aproveita uma janela da mesma origem.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          try {
            await c.navigate(target);
          } catch {
            /* a janela não deixou navegar: só a trazemos para a frente */
          }
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
