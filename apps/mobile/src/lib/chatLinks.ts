/**
 * Ligações e @menções no texto das bolhas do chat, sem React (testado em tests/chatLinks.test.mjs).
 * As mesmas regras do site (apps/web/src/components/LinkPreview.tsx, `Linkified`) e do RichText:
 *  - só http(s), sem utilizador e senha no endereço; a pontuação no fim ("veja isto: https://x.com/a.") fica de fora;
 *  - ligações do próprio Txillapp (publicações, reels, perfis, mimos, convites, grupos…) abrem dentro da app;
 *  - @username (3 a 30 letras, números, "_" e ".") abre o perfil; não conta colado a letras ("a@b.com") nem o ponto final.
 * Sem o `URL` do React Native (o do Android/iPhone é feito à mão e falha em endereços simples): tudo por expressões.
 */

export type ChatSeg =
  | { t: 'text'; s: string }
  | { t: 'url'; s: string; href: string; path: string | null }
  | { t: 'mention'; s: string; username: string };

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAIL = /[.,;:!?)\]}»”’]+$/;
const MENTION = /(?<![\p{L}\p{N}_.&#@/])@([a-zA-Z0-9_.]{3,30})/gu;
/** Endereço http(s): esquema, anfitrião (sem utilizador:senha), porta e o resto. */
const PARTS = /^(https?):\/\/([^/?#\s@]+)(?::\d{1,5})?([/?#][^\s]*)?$/i;
const OWN_HOSTS = new Set(['txillapp.com', 'www.txillapp.com', 'app.txillapp.com']);
/** O primeiro pedaço do caminho que é um ecrã da app (o resto, ex. /api ou /tiles, abre fora). */
const APP_ROUTES = new Set(['p', 'r', 'u', 'm', 'c', 'g', 't', 'tag', 'v', 'evento', 'place', 'reels', 'stories', 'locais', 'perto', 'geleira', 'invites']);

/** O endereço limpo (sem a pontuação do fim) e, se for do Txillapp e de um ecrã da app, o caminho para abrir lá dentro. */
export function chatUrl(raw: string): { href: string; path: string | null } | null {
  const href = raw.replace(TRAIL, '');
  const m = PARTS.exec(href);
  if (!m) return null;
  const host = m[2].toLowerCase().replace(/:\d+$/, '');
  if (!host.includes('.') || host.includes(':')) return null;
  const rest = m[3] ?? '';
  if (!OWN_HOSTS.has(host)) return { href, path: null };
  const path = rest.startsWith('/') ? rest.split('#')[0] : '/';
  const first = path.slice(1).split(/[/?]/)[0];
  return { href, path: APP_ROUTES.has(first) ? path : null };
}

function mentions(text: string, out: ChatSeg[]) {
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const name = m[1].replace(/\.+$/, '');
    if (name.length < 3) continue;
    const start = m.index!;
    if (start > last) out.push({ t: 'text', s: text.slice(last, start) });
    out.push({ t: 'mention', s: `@${name}`, username: name });
    last = start + 1 + name.length;
  }
  if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
}

/** O texto em pedaços: texto, ligações e @menções (na ordem). Sem nada disso, um só pedaço de texto. */
export function chatSegments(text: string): ChatSeg[] {
  const out: ChatSeg[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const u = chatUrl(m[0]);
    if (!u) continue;
    const start = m.index!;
    if (start > last) mentions(text.slice(last, start), out);
    out.push({ t: 'url', s: u.href, href: u.href, path: u.path });
    last = start + u.href.length;
  }
  if (last < text.length) mentions(text.slice(last), out);
  return out.length ? out : [{ t: 'text', s: text }];
}
