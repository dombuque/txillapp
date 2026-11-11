// Notificações push (importado pelo service worker, /sw.js).
// O ícone grande e o ícone pequeno da barra de estado têm de ser PNG (o Android ignora SVG nas notificações);
// o pequeno é só uma silhueta (o Android pinta-o de uma cor só).
//
// Chamadas (o que a web deixa fazer):
//  - Android (Chrome): notificação que fica até se responder, vibra como um telefone, com Atender e Recusar; o servidor
//    reenvia o aviso de 9 em 9 s enquanto toca (até 30 s) e ela volta a vibrar e a soar. Não há ecrã de chamada por cima
//    do ecrã bloqueado nem toque contínuo (isso só numa app nativa).
//  - iPhone (app no ecrã principal): só uma notificação com o som normal, sem botões (o Safari não mostra ações) e sem
//    vibração própria. O Safari tira a permissão a quem recebe avisos sem mostrar nada, por isso aqui mostra-se SEMPRE
//    uma notificação em cada aviso de chamada (mesmo com a app à vista; nesse caso fecha-se logo a seguir).
//  - Atender (ou tocar na notificação) abre /call/<id>?…&accept=1 e a app atende logo. Recusar recusa a partir daqui,
//    com o código que veio no aviso (sem abrir a app). Atendida ou recusada noutro sítio: chega um aviso 'call_end' que
//    fecha a notificação; perdida ou cancelada, a notificação de chamada perdida (mesma etiqueta) toma o lugar dela.

/** Safari / WebKit (iPhone, iPad, Mac): não deixa avisos sem notificação, nem mostra botões. */
const TX_APPLE = (() => {
  try {
    const ua = String((self.navigator && self.navigator.userAgent) || '');
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(ua));
  } catch {
    return false;
  }
})();

/** Vibração de "a tocar" (o Android Chrome respeita; o iPhone ignora). */
const TX_RING_VIBRATE = [1000, 600, 1000, 600, 1000, 600, 1000, 600, 1000];
/** Uma chamada que toca há mais do que isto já acabou (o toque do servidor é de 45 s). */
const TX_RING_MAX_MS = 60_000;

/** Chamadas que este aparelho já tratou (Atender/Recusar aqui) e notificações que a pessoa afastou. Só em memória. */
const txHandled = new Set();
const txDismissed = new Set();
function txRemember(set, id) {
  set.add(id);
  if (set.size > 50) set.delete(set.values().next().value);
}

/** Os dados de uma chamada no aviso (podem vir soltos ou dentro de "data"). */
function txCallInfo(data, extra) {
  data = data || {};
  extra = extra || {};
  const pick = (k) => (data[k] !== undefined ? data[k] : extra[k]);
  const v = pick('video');
  return {
    callId: String(pick('callId') || ''),
    from: String(pick('from') || ''),
    name: String(data.title || extra.title || ''),
    video: v === true || v === 1 || v === '1' || v === 'true',
    declineToken: pick('declineToken') ? String(pick('declineToken')) : '',
    repeat: pick('repeat') === '1' || pick('repeat') === true,
    reason: String(pick('reason') || ''),
  };
}

/** Endereço da chamada na app; `accept` atende logo, `decline` recusa logo. */
function txCallUrl(c, mode) {
  return '/call/' + encodeURIComponent(c.callId) + '?from=' + encodeURIComponent(c.from) + '&video=' + (c.video ? 1 : 0) + (mode ? '&' + mode + '=1' : '');
}

/**
 * Título e opções da notificação a tocar. `quiet`: mostra-se sem som nem vibração (a app já está à vista no iPhone,
 * ou a pessoa afastou a notificação e chegou um reenvio).
 */
function txCallNotification(c, o) {
  o = o || {};
  const now = o.now || Date.now();
  const who = c.name || c.from;
  const options = {
    body: (c.video ? 'Videochamada' : 'Chamada de voz') + (who ? ' de ' + who : ''),
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: 'call-' + c.callId,
    renotify: !o.quiet,
    silent: !!o.quiet,
    requireInteraction: true,
    timestamp: now,
    lang: 'pt',
    data: { url: txCallUrl(c, 'accept'), kind: 'call', callId: c.callId, from: c.from, name: c.name, video: c.video ? '1' : '0', declineToken: c.declineToken, at: now },
  };
  // O Chrome recusa vibração numa notificação silenciosa.
  if (!o.quiet) options.vibrate = TX_RING_VIBRATE;
  // O Safari não mostra botões: só fora do Safari.
  if (!o.apple) {
    options.actions = [
      { action: 'answer', title: 'Atender' },
      { action: 'decline', title: 'Recusar' },
    ];
  }
  return { title: who || 'Txillapp', options };
}

/** Notificação discreta que fica no lugar da que tocava, quando a chamada foi atendida ou recusada noutro aparelho. */
function txEndNotification(c, o) {
  o = o || {};
  const who = c.name && c.name !== 'Txillapp' ? c.name : '';
  return {
    title: who || 'Txillapp',
    options: {
      body: c.reason === 'accepted' ? 'Chamada atendida noutro aparelho' : 'Chamada recusada',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: 'call-' + c.callId,
      renotify: false,
      silent: true,
      timestamp: o.now || Date.now(),
      lang: 'pt',
      data: { url: '/calls', kind: 'call_end', callId: c.callId },
    },
  };
}

/**
 * O que fazer com um aviso de chamada a tocar. `visible`: há uma janela do Txillapp à vista (a app já toca sozinha).
 * Devolve 'skip' (não mostrar), 'ring' (mostrar a tocar) ou 'quiet' (mostrar sem som).
 */
function txRingMode(c, s) {
  if (!c.callId) return 'skip';
  if (s.handled || s.visible) return s.apple ? 'quiet' : 'skip';
  if (c.repeat && s.dismissed) return 'quiet';
  return 'ring';
}

/** Atendida ou recusada: 'close' (só fechar) ou 'replace' (fechar e deixar uma notificação discreta). */
/** Mensagem com o chat à vista: noutros browsers não se mostra; no Safari tem de se mostrar (sem som) e fecha-se logo. */
function txMessageMode(s) {
  if (!s.inChat) return 'show';
  return s.apple ? 'quiet' : 'skip';
}

function txEndMode(s) {
  if (s.apple) return 'replace';
  return s.had && !s.visible ? 'replace' : 'close';
}

function txWindows() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) =>
    list.filter((c) => {
      try {
        return new URL(c.url).origin === self.location.origin;
      } catch {
        return false;
      }
    }),
  );
}
const txVisible = (list) => list.some((c) => c.visibilityState === 'visible');
const txTell = (list, msg) => list.forEach((c) => { try { c.postMessage(msg); } catch { /* janela a fechar */ } });

/** Fecha esta notificação daqui a pouco (fora do waitUntil: o browser já a contou como mostrada). */
function txCloseLater(tag, ms) {
  setTimeout(() => {
    self.registration.getNotifications({ tag }).then((l) => l.forEach((n) => n.close())).catch(() => undefined);
  }, ms);
}

async function txOnRing(c) {
  const wins = await txWindows();
  const visible = txVisible(wins);
  // Com a app aberta (mesmo escondida), ela própria passa a tocar se o canal em tempo real tiver falhado o aviso.
  txTell(wins, { type: 'tx-call-ring', call: { callId: c.callId, from: c.from, name: c.name, video: c.video } });
  const mode = txRingMode(c, { visible, handled: txHandled.has(c.callId), dismissed: txDismissed.has(c.callId), apple: TX_APPLE });
  if (mode === 'skip') return undefined;
  const n = txCallNotification(c, { quiet: mode === 'quiet', apple: TX_APPLE });
  await self.registration.showNotification(n.title, n.options);
  // iPhone com a app à vista: tinha de se mostrar (regra do Safari), mas a app já está a tocar.
  if (TX_APPLE && visible) txCloseLater(n.options.tag, 1500);
  return undefined;
}

async function txOnEnd(c) {
  const tag = 'call-' + c.callId;
  const open = await self.registration.getNotifications({ tag }).catch(() => []);
  const had = open.some((n) => (n.data || {}).kind === 'call');
  open.forEach((n) => n.close());
  txHandled.delete(c.callId);
  txDismissed.delete(c.callId);
  const wins = await txWindows();
  const visible = txVisible(wins);
  txTell(wins, { type: 'tx-call-end', callId: c.callId, reason: c.reason });
  if (txEndMode({ apple: TX_APPLE, had, visible }) === 'close') return undefined;
  const n = txEndNotification(c);
  await self.registration.showNotification(n.title, n.options);
  txCloseLater(tag, visible ? 1500 : 8000);
  return undefined;
}

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
    event.waitUntil(txOnRing(txCallInfo(data, extra)));
    return;
  }
  if (kind === 'call_end') {
    event.waitUntil(txOnEnd(txCallInfo(data, extra)));
    return;
  }
  if (kind === 'missed_call') {
    // Chamada perdida: abre /calls e substitui a notificação que estava a tocar (mesma etiqueta).
    if (!data.url) data.url = '/calls';
    const id = data.callId || extra.callId;
    if (!data.tag && id) data.tag = 'call-' + id;
    if (id) {
      txHandled.delete(String(id));
      txDismissed.delete(String(id));
    }
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
      const mode = txMessageMode({ inChat, apple: TX_APPLE });
      if (mode === 'skip') return undefined;
      const quiet = mode === 'quiet';
      // iPhone/Safari: um aviso sem notificação conta como "silencioso" e, ao fim de poucos, o Safari cancela a
      // subscrição (as notificações deixam de chegar de vez). Por isso mostra-se sempre, sem som, e fecha-se logo.
      const tag = data.tag || (quiet ? 'tx-quiet' : undefined);
      return self.registration
        .showNotification(data.title || 'Txillapp', {
          body: data.body || '',
          icon: '/icon-192.png',
          badge: '/badge-96.png',
          tag,
          // Mesma conversa/pessoa: a notificação nova substitui a antiga mas volta a avisar (som e vibração).
          renotify: !quiet && !!tag,
          silent: quiet,
          timestamp: Date.now(),
          lang: 'pt',
          data: { url: data.url || '/' },
        })
        .then(() => {
          if (quiet) txCloseLater(tag, 1500);
        });
    }),
  );
});

/** Recusar a partir da notificação: pelo código do aviso; sem ele (ou sem rede), pede a uma janela aberta que recuse. */
async function txDecline(nd) {
  const wins = await txWindows();
  if (nd.declineToken) {
    try {
      const r = await fetch('/api/v1/calls/' + encodeURIComponent(nd.callId) + '/decline-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'txillapp' },
        body: JSON.stringify({ token: nd.declineToken }),
        credentials: 'omit',
      });
      // 409: já não estava a tocar; 404: código que não serve. Nos dois casos não há mais nada a fazer.
      if (r.ok || r.status === 409 || r.status === 404) {
        txTell(wins, { type: 'tx-call-end', callId: nd.callId, reason: 'declined' });
        return;
      }
    } catch {
      /* sem rede: tenta pela janela */
    }
  }
  if (wins.length) {
    txTell(wins, { type: 'tx-call-decline', callId: nd.callId });
    return;
  }
  // Sem código e sem janela: abre a app, que recusa e fecha o ecrã da chamada.
  await self.clients.openWindow(txCallUrl({ callId: nd.callId, from: nd.from || '', video: nd.video === '1' }, 'decline'));
}

self.addEventListener('notificationclose', (event) => {
  const nd = event.notification.data || {};
  if (nd.kind === 'call' && nd.callId) txRemember(txDismissed, String(nd.callId));
});

// Ao tocar: se a app já está aberta, vai para lá; senão abre. Só se aproveita uma janela da mesma origem.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const nd = event.notification.data || {};
  if (nd.kind === 'call' && nd.callId) {
    txRemember(txHandled, String(nd.callId));
    if (event.action === 'decline') {
      event.waitUntil(txDecline(nd));
      return;
    }
  }
  let url = nd.url || '/';
  // Notificação de chamada antiga (já não toca): vai para a lista de chamadas em vez de tentar atender.
  if (nd.kind === 'call' && nd.at && Date.now() - Number(nd.at) > TX_RING_MAX_MS) url = '/calls';
  const target = new URL(url, self.location.origin).href;
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

// Para os testes (tests/pushSw.test.mjs): as regras puras.
self.__txCall = { txCallInfo, txCallUrl, txCallNotification, txEndNotification, txRingMode, txEndMode, txMessageMode, TX_RING_VIBRATE };
