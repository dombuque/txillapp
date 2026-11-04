import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { tr } from '../lib/i18n';
import Icon from './Icon';
import SharedPost from './SharedPost';
import { Avatar } from './ui';

/**
 * Ligações nas mensagens, sem o servidor abrir nada por ti (isso seria um risco: pedidos a endereços escolhidos por outros).
 *  - Ligações do próprio Txillapp (publicações, reels, perfis): cartão com o que a pessoa já pode ver, pelos pedidos normais da app.
 *  - Outras ligações: só o domínio, com um aviso de que sai da app. Nada é descarregado e o site não vê o teu endereço (noreferrer).
 */
const OWN_HOSTS = new Set(['txillapp.com', 'www.txillapp.com', 'app.txillapp.com']);
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAIL = /[.,;:!?)\]}»”’]+$/;

/** Só endereços http(s) sem utilizador e senha. */
export function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.replace(TRAIL, ''));
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

export function firstUrl(text: string): URL | null {
  const m = text.match(URL_RE);
  return m ? safeUrl(m[0]) : null;
}

/** Texto com as ligações clicáveis (abrem noutro separador, sem passar o endereço da app). */
export function Linkified({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const u = safeUrl(m[0]);
    if (!u) continue;
    const shown = m[0].replace(TRAIL, '');
    const start = m.index!;
    if (start > last) out.push(text.slice(last, start));
    const own = OWN_HOSTS.has(u.hostname.toLowerCase());
    out.push(
      own ? (
        <Link key={start} to={u.pathname + u.search} onClick={(e) => e.stopPropagation()} className="underline underline-offset-2">{shown}</Link>
      ) : (
        <a key={start} href={u.href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="underline underline-offset-2">{shown}</a>
      ),
    );
    last = start + shown.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export default function LinkPreview({ url, shape, tone }: { url: URL; shape: string; tone: string }) {
  const own = OWN_HOSTS.has(url.hostname.toLowerCase());
  const post = own ? url.pathname.match(/^\/[pr]\/([A-Za-z0-9_-]{4,40})\/?$/) : null;
  const prof = own && !post ? url.pathname.match(/^\/u\/([A-Za-z0-9_.]{3,30})\/?$/) : null;
  const pq = useQuery({ queryKey: ['post', post?.[1]], queryFn: () => api.getPost(post![1]), enabled: !!post, retry: false, staleTime: 60_000 });
  const uq = useQuery({ queryKey: ['profile', prof?.[1]], queryFn: () => api.profile(prof![1]), enabled: !!prof, retry: false, staleTime: 60_000 });

  if (post) return <SharedPost post={pq.isError ? null : (pq.data ?? null)} shape={shape} tone={tone} />;
  if (prof) {
    const p = uq.data;
    return (
      <Link to={`/u/${prof[1]}`} onClick={(e) => e.stopPropagation()} className={`flex w-[240px] items-center gap-3 px-3 py-3 ${shape} ${tone}`}>
        <Avatar name={p?.displayName ?? prof[1]} username={p ? prof[1] : undefined} size={44} ring={false} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{p?.displayName ?? `@${prof[1]}`}</span>
          <span className="block truncate text-[13px] opacity-80">{uq.isError ? tr('Perfil indisponível') : `@${prof[1]}`}</span>
        </span>
      </Link>
    );
  }
  if (own) return null; // outras páginas do Txillapp: só a ligação
  return (
    <a href={url.href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className={`flex w-[240px] items-center gap-3 px-3 py-3 ${shape} ${tone}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/10"><Icon name="globe" size={20} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{url.hostname.replace(/^www\./, '')}</span>
        <span className="block truncate text-[12px] opacity-80">{url.protocol === 'http:' ? tr('Ligação não segura (http)') : tr('Ligação externa: abre fora do Txillapp')}</span>
      </span>
    </a>
  );
}
