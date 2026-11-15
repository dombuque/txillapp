/**
 * O que fazer com o texto de um QR lido (o leitor em src/app/qr.tsx), sem React (testado em tests/qrRead.test.mjs):
 *  - ligação do Txillapp (txillapp.com/u/…, /p/…, /c/CÓDIGO, /txillada/…, ou txillapp://…) → o ecrã dentro da app;
 *  - outra ligação http(s) → mostra-se o endereço e pergunta-se se abre no browser;
 *  - o resto (texto, Wi-Fi, mailto:, javascript:…) → só se mostra e copia (nunca se abre).
 * Sem o `URL` do React Native (o do Android/iPhone é feito à mão e falha em endereços simples): tudo por expressões.
 */

export type QrRead =
  | { kind: 'app'; path: string; label: string; href: string }
  | { kind: 'url'; href: string; host: string }
  | { kind: 'text'; text: string };

/** Os anfitriões do Txillapp (os mesmos do chat: lib/chatLinks.ts). */
export const QR_OWN_HOSTS = ['txillapp.com', 'www.txillapp.com', 'app.txillapp.com'] as const;

/** O primeiro pedaço do caminho que é um ecrã da app, e o que se diz enquanto abre. */
const ROUTES: Record<string, (id: string) => string> = {
  u: (id) => `Perfil de @${id}`,
  m: (id) => `Mimos de ${id.startsWith('@') ? id : `@${id}`}`,
  p: () => 'Publicação',
  r: () => 'Reel',
  c: () => 'Convite',
  g: () => 'TxillGroup',
  t: (id) => `#${id}`,
  tag: (id) => `#${id}`,
  v: () => 'Local',
  evento: () => 'Evento',
  place: () => 'Lugar',
  txillada: () => 'Txillada',
  reels: () => 'Reels',
  stories: () => 'Mimos',
  locais: () => 'Locais',
  perto: () => 'À tua volta',
  geleira: () => 'Geleira',
  invites: () => 'Convites',
  termos: () => 'Termos', terms: () => 'Termos', privacidade: () => 'Privacidade', privacy: () => 'Privacidade',
  help: () => 'Ajuda', suporte: () => 'Ajuda', about: () => 'Sobre o Txillapp', 'apagar-conta': () => 'Apagar a conta',
};
/** Ecrãs que só existem com um código depois (/u sozinho não é nada). */
const NEEDS_ID = new Set(['u', 'm', 'p', 'r', 'c', 'g', 't', 'tag', 'v', 'evento', 'place', 'txillada']);

const PARTS = /^(https?):\/\/([^/?#\s@]+)([/?#][^\s]*)?$/i;
const USERNAME = /^@([a-zA-Z0-9_.]{3,30})$/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * O caminho da app para `rest` (o que vem depois do anfitrião), ou null se não for um ecrã da app.
 * Tira o #, a barra do fim e recusa caminhos estranhos (.., \, //).
 */
export function qrAppPath(rest: string): { path: string; label: string } | null {
  let path = (rest || '/').split('#')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  const [pathname, query] = [path.split('?')[0], path.includes('?') ? path.slice(path.indexOf('?')) : ''];
  const clean = pathname.replace(/\/+$/, '');
  if (!clean) return { path: '/', label: 'Txillapp' };
  if (/\.\.|\\|\/\//.test(clean)) return null;
  const segs = clean.slice(1).split('/');
  const first = segs[0].toLowerCase();
  const label = ROUTES[first];
  if (!label) return null;
  const id = segs[1] ? safeDecode(segs[1]) : '';
  if (NEEDS_ID.has(first) && !id) return null;
  return { path: `/${[first, ...segs.slice(1)].join('/')}${query}`, label: label(id) };
}

/**
 * O que é o texto lido. `extraHosts`: anfitriões que também contam como Txillapp (no site, o do próprio site, ex.
 * localhost ou uma pré-visualização), em minúsculas.
 */
export function readQr(raw: string, extraHosts: readonly string[] = []): QrRead {
  const text = (raw ?? '').replace(/^﻿/, '').trim();
  if (!text) return { kind: 'text', text: '' };
  // @username sozinho: o perfil.
  const at = USERNAME.exec(text);
  if (at) return { kind: 'app', path: `/u/${at[1]}`, label: `Perfil de @${at[1]}`, href: text };
  // O esquema da app (txillapp://u/sara ou txillapp:///u/sara).
  const own = /^txillapp:\/\/\/?([^\s]*)$/i.exec(text);
  if (own) {
    const hit = qrAppPath(`/${own[1]}`);
    return hit ? { kind: 'app', ...hit, href: text } : { kind: 'text', text };
  }
  // Sem esquema: txillapp.com/u/sara, www.exemplo.com/x.
  let href = text;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && /^(?:www\.|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#]|$))/i.test(text) && !/\s/.test(text)) href = `https://${text}`;
  const m = PARTS.exec(href);
  if (!m) return { kind: 'text', text };
  const hostPort = m[2].toLowerCase();
  const host = hostPort.replace(/:\d{1,5}$/, '');
  // Com utilizador:senha, sem ponto (a não ser o localhost do próprio site) ou com coisas estranhas: fica texto.
  if (/[^a-z0-9.\-[\]:]/.test(hostPort)) return { kind: 'text', text };
  const mine = (QR_OWN_HOSTS as readonly string[]).includes(host) || extraHosts.includes(hostPort) || extraHosts.includes(host);
  if (mine) {
    const hit = qrAppPath(m[3] ?? '/');
    if (hit) return { kind: 'app', ...hit, href };
  }
  if (!host.includes('.') && !mine) return { kind: 'text', text };
  return { kind: 'url', href, host };
}
