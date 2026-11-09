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
  // Chamadas: o payload pode trazer os campos soltos ou dentro de "data".
  const extra = data.data && typeof data.data === 'object' ? data.data : {};
  const kind = data.kind || extra.kind;
  if (kind === 'call') {
    event.waitUntil(showCall(data, extra));
    return;
  }
  if (kind === 'missed_call') {
    // Chamada perdida: abre /calls e substitui a notificação que estava a tocar (mesma etiqueta).
    if (!data.url) data.url = '/calls';
    const id = data.callId || extra.callId;
    if (!data.tag && id) data.tag = 'call-' + id;
  }
  event.waitUntil(
    // Se estás a olhar para o chat (app à frente, em qualquer conversa), a mensagem já aparece lá: não se avisa em cima.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const inChat = String(data.url || '').startsWith('/messages') && list.some((c) => {
        try {
          return c.visibilityState === 'visible' && new URL(c.url).pathname.startsWith('/messages');
        } catch {
          return false;
        }
      });
      if (inChat) return undefined;
      return self.registration.showNotification(data.title || 'Txillapp', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: data.tag,
        // Mesma conversa/pessoa: a notificação nova substitui a antiga mas volta a avisar (som e vibração).
        renotify: !!data.tag,
        timestamp: Date.now(),
        lang: 'pt',
        data: { url: data.url || '/' },
      });
    }),
  );
});

// Chamada a tocar: fica no ecrã até se atender ou recusar, com som e vibração. Com o Txillapp à vista não aparece
// (o ecrã de chamada da app já toca). Atender (ou tocar na notificação) abre /call/<id>?from=<username>&video=<0|1>.
function showCall(data, extra) {
  const callId = String(data.callId || extra.callId || '');
  const from = String(data.from || extra.from || '');
  const v = data.video !== undefined ? data.video : extra.video;
  const video = v === true || v === 1 || v === '1' || v === 'true';
  const url = '/call/' + encodeURIComponent(callId) + '?from=' + encodeURIComponent(from) + '&video=' + (video ? 1 : 0);
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const visible = list.some((c) => {
      try {
        return c.visibilityState === 'visible' && new URL(c.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });
    if (visible || !callId) return undefined;
    return self.registration.showNotification(data.title || from || 'Txillapp', {
      body: data.body || (video ? 'Videochamada' : 'Está a ligar-te'),
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: 'call-' + callId,
      renotify: true,
      requireInteraction: true,
      vibrate: [900, 700, 900, 700, 900, 700, 900],
      timestamp: Date.now(),
      lang: 'pt',
      actions: [
        { action: 'answer', title: 'Atender' },
        { action: 'decline', title: 'Recusar' },
      ],
      data: { url, kind: 'call', callId, from, video: video ? '1' : '0' },
    });
  });
}

// Ao tocar: se a app já está aberta, vai para lá; senão abre. Só se aproveita uma janela da mesma origem.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const nd = event.notification.data || {};
  // Recusar uma chamada: não abre nada. Pede a uma janela aberta do Txillapp que recuse (a sessão está na página);
  // sem janela aberta, a chamada acaba sozinha como perdida.
  if (nd.kind === 'call' && event.action === 'decline') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        for (const c of list) c.postMessage({ type: 'tx-call-decline', callId: nd.callId });
      }),
    );
    return;
  }
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
