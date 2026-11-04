import { useQuery } from '@tanstack/react-query';
import { funny } from '../lib/copy';
import { tr } from '../lib/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { renderGiftCard } from '../lib/giftCard';
import { api, type Post } from '../lib/api';
import { sized } from '../lib/media';
import { postLink, postShare, shareNow } from '../lib/share';
import Icon, { type IconName } from './Icon';
import NewChat from './NewChat';
import { Avatar } from './ui';

/** Uma conversa (pessoa ou grupo) na grelha de partilha. */
interface Target {
  key: string;
  kind: 'user' | 'group';
  id: string; // @utilizador ou id do grupo
  name: string;
  avatars: { name: string; username?: string }[];
  online: boolean;
  /** Minutos desde que esteve online (só se foi há menos de uma hora). */
  recent: number | null;
  at: string;
}

/**
 * Partilhar uma publicação ou reel, como no Instagram: pesquisa e "criar grupo" no topo, grelha das conversas recentes
 * (toca para escolher várias) e, em baixo, as ações: status, amigos próximos, WhatsApp, copiar link e o menu do telemóvel.
 * Escolhidas pessoas, a barra de baixo passa a ser uma mensagem opcional e o botão Enviar.
 */
export default function ShareSheet({ post, onClose, layer = 'z-50' }: { post: Post; onClose: () => void; layer?: string }) {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Target[]>([]);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [preview, setPreview] = useState<'all' | 'close_friends' | null>(null);
  const [caption, setCaption] = useState('');
  const url = postLink(post);
  // Presente: a pré-visualização mostra o cartão que vai para o status.
  const [giftUrl, setGiftUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!preview || post.kind !== 'gift' || giftUrl) return;
    let dead = false;
    void renderGiftCard(post).then((b) => !dead && setGiftUrl(URL.createObjectURL(b))).catch(() => undefined);
    return () => { dead = true; };
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  const video = post.media[0]?.kind === 'video';
  const canStory = (post.kind === 'post' && post.media.length > 0) || (post.kind === 'gift' && !!post.gift);

  const direct = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, staleTime: 30_000 });
  const groups = useQuery({ queryKey: ['chat-groups'], queryFn: api.chatGroups, staleTime: 30_000 });
  const t = term.trim().replace(/^@/, '').toLowerCase();
  const found = useQuery({ queryKey: ['mentionable', t], queryFn: () => api.mentionable(t), enabled: t.length >= 1, staleTime: 30_000 });

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const recents = useMemo<Target[]>(() => {
    const mins = (iso: string | null | undefined) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null);
    const people = (direct.data ?? []).filter((c) => !c.request).map((c): Target => {
      const m = mins(c.presence?.lastSeen);
      return {
        key: `u:${c.username}`, kind: 'user', id: c.username, name: c.displayName,
        avatars: [{ name: c.displayName, username: c.hasAvatar ? c.username : undefined }],
        online: !!c.presence?.online, recent: !c.presence?.online && m !== null && m < 60 ? Math.max(1, m) : null, at: c.lastMessage.at,
      };
    });
    const gs = (groups.data ?? []).map((g): Target => ({
      key: `g:${g.id}`, kind: 'group', id: g.id, name: g.name,
      avatars: g.preview.slice(0, 2).map((p) => ({ name: p.displayName, username: p.hasAvatar ? p.username : undefined })),
      online: false, recent: null, at: g.lastMessage.at,
    }));
    return [...people, ...gs].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }, [direct.data, groups.data]);

  const list = useMemo<Target[]>(() => {
    if (!t) return recents;
    const have = new Set(recents.map((r) => r.key));
    const hits = recents.filter((r) => r.name.toLowerCase().includes(t) || r.id.toLowerCase().includes(t));
    const more = (found.data ?? [])
      .filter((p) => !have.has(`u:${p.username}`))
      .map((p): Target => ({ key: `u:${p.username}`, kind: 'user', id: p.username, name: p.displayName, avatars: [{ name: p.displayName, username: p.hasAvatar ? p.username : undefined }], online: false, recent: null, at: '' }));
    return [...hits, ...more];
  }, [t, recents, found.data]);

  const isPicked = (k: string) => picked.some((p) => p.key === k);
  const toggle = (x: Target) => setPicked((l) => (isPicked(x.key) ? l.filter((p) => p.key !== x.key) : [...l, x]));

  async function sendAll() {
    setBusy(true);
    setNote('');
    const failed: string[] = [];
    for (const x of picked) {
      try {
        const body = (kind: 'post' | 'text', text: string) => ({ kind, body: text });
        const send = (b: { kind: 'post' | 'text'; body: string }) => (x.kind === 'user' ? api.chatSend(x.id, b) : api.chatGroupSend(x.id, b));
        await send(body('post', post.id));
        if (message.trim()) await send(body('text', message.trim()));
      } catch (e) {
        failed.push(`${x.name}: ${(e as Error).message}`);
      }
    }
    track('share', { where: 'chat', video, to: picked.length });
    setBusy(false);
    if (failed.length) return setNote(failed.join(' · '));
    setNote(picked.length === 1 ? tr('Enviado a {name}', { name: picked[0].name }) : tr('Enviado a {n} conversas', { n: picked.length }));
    setTimeout(onClose, 900);
  }

  // Escolher o status abre primeiro a pré-visualização (como no Instagram): vês como fica, escreves uma legenda e só depois partilhas.
  function toStory(audience: 'all' | 'close_friends') {
    if (!canStory) return setNote(tr('Só se partilham no status publicações com foto ou vídeo'));
    setPreview(audience);
  }
  async function publishStory() {
    if (!preview) return;
    setBusy(true);
    try {
      if (post.kind === 'gift') {
        // Presente: o cartão desenhado (e não um texto) vai para o status como imagem.
        const f = new File([await renderGiftCard(post)], 'presente.png', { type: 'image/png' });
        await api.createStory(await api.uploadImage(f), caption.trim(), preview);
      } else await api.shareToStory(post.id, preview, caption.trim());
      track('share', { where: 'story', video });
      setPreview(null);
      setNote(preview === 'all' ? 'Adicionado ao teu status' : 'Partilhado com amigos próximos');
      setTimeout(onClose, 1000);
    } catch (e) {
      setNote((e as Error).message);
      setPreview(null);
    }
    setBusy(false);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNote(funny('copied'));
    } catch {
      setNote(tr('Não consegui copiar'));
    }
  }
  const data = postShare(post.author.displayName, post.body, url);
  function whatsapp() {
    track('share', { where: 'whatsapp' });
    window.open(`https://wa.me/?text=${encodeURIComponent(data.text ? `${data.text}\n${url}` : url)}`, '_blank', 'noopener');
  }
  // O WhatsApp não tem ligação direta ao status: o que se consegue é entregar a foto ou vídeo ao menu de partilha do telemóvel,
  // onde o WhatsApp oferece "Status". Por isso envia-se o ficheiro (não o link) e a pessoa escolhe o Status.
  // O ficheiro do status: o vídeo (ou a foto) tal como está, sem moldura. Para os vídeos descarrega-se logo ao abrir a partilha:
  // se só se descarregasse depois do toque, o telemóvel podia recusar a partilha por ter demorado.
  async function buildStoryFile(): Promise<File | null> {
    const m = post.media[0];
    if (!m) return null;
    const isVideo = m.kind === 'video';
    const res = await fetch(isVideo ? m.url : sized(m.url, 1080));
    if (!res.ok) return null;
    const blob = await res.blob();
    // Alguns servidores respondem com um tipo genérico (octet-stream): o WhatsApp só toca o vídeo se for mesmo "video/mp4".
    const type = isVideo ? 'video/mp4' : blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const ext = isVideo ? 'mp4' : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return new File([blob], `txillapp-${post.code ?? post.id}.${ext}`, { type });
  }
  const storyFile = useRef<Promise<File | null> | null>(null);
  useEffect(() => {
    if (video && post.media[0] && typeof navigator.canShare === 'function') storyFile.current = buildStoryFile().catch(() => null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function whatsappStory() {
    track('share', { where: 'whatsapp-status' });
    const m = post.media[0];
    if (!m) return setNote(tr('Só publicações com foto ou vídeo vão para o status do WhatsApp'));
    setBusy(true);
    try {
      const file = await (storyFile.current ?? buildStoryFile());
      if (!file) throw new Error('sem ficheiro');
      // A legenda leva só o link curto, clicável (nos vídeos vai só o ficheiro, para o WhatsApp o tocar como vídeo).
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share(m.kind === 'video' ? { files: [file] } : { files: [file], text: url });
        onClose();
      } else {
        setNote(tr('Este telemóvel não deixa partilhar o ficheiro diretamente. Usa "Partilhar…" ou guarda a foto.'));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setNote(tr('Não consegui preparar a foto para o status'));
    }
    setBusy(false);
  }
  function network(where: string, href: string) {
    track('share', { where });
    window.open(href, '_blank', 'noopener');
  }
  async function system() {
    track('share', { where: 'system' });
    const r = await shareNow(data);
    if (r === 'shared') onClose();
    else if (r === 'copied') setNote(tr('Texto e link copiados'));
    else if (r === 'failed') setNote(tr('Não consegui copiar'));
  }

  const action = (icon: IconName, label: string, run: () => void, tone = 'bg-zinc-100 text-zinc-900', disabled = false) => (
    <button key={label} type="button" onClick={run} disabled={disabled || busy} className="flex w-[74px] shrink-0 flex-col items-center gap-1.5 active:scale-95 disabled:opacity-50">
      <span className={`flex h-14 w-14 items-center justify-center rounded-full ${tone}`}><Icon name={icon} size={26} /></span>
      <span className="w-full text-center text-[12px] font-medium leading-tight text-zinc-700">{label}</span>
    </button>
  );

  const letter = (label: string, mark: string, tone: string, run: () => void) => (
    <button key={label} type="button" onClick={run} className="flex w-[74px] shrink-0 flex-col items-center gap-1.5 active:scale-95">
      <span className={`flex h-14 w-14 items-center justify-center rounded-full text-[24px] font-extrabold text-white ${tone}`} aria-hidden>{mark}</span>
      <span className="w-full text-center text-[12px] font-medium leading-tight text-zinc-700">{label}</span>
    </button>
  );

  return (
    <>
      <div className={`fixed inset-0 ${layer} flex items-end justify-center bg-black/40`} onClick={onClose} role="presentation">
        <div role="dialog" aria-modal="true" aria-label={tr('Partilhar')} className="flex max-h-[88dvh] w-full max-w-xl animate-[rise_.25s_ease-out] flex-col rounded-t-[28px] bg-white" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-zinc-300" aria-hidden />

          <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-zinc-100 px-4 text-zinc-500 transition focus-within:bg-zinc-200/70">
              <Icon name="search" size={18} />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={tr('Procurar')} aria-label={tr('Procurar pessoas e grupos')} className="min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500" />
            </label>
            <button type="button" onClick={() => setGrouping(true)} aria-label={tr('Criar grupo')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 active:scale-90"><Icon name="user-plus" size={22} /></button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
            {(direct.isLoading || groups.isLoading) && <p className="py-10 text-center text-zinc-500">{tr('A carregar…')}</p>}
            {!direct.isLoading && list.length === 0 && <p className="py-10 text-center text-zinc-500">{t ? tr('Ninguém com esse nome') : tr('Ainda não tens conversas. Procura alguém pelo nome.')}</p>}
            <ul className="grid grid-cols-3 gap-y-4 pt-2">
              {list.map((x) => {
                const on = isPicked(x.key);
                return (
                  <li key={x.key}>
                    <button type="button" onClick={() => toggle(x)} aria-pressed={on} className="flex w-full flex-col items-center gap-1.5 px-1 active:scale-95">
                      <span className="relative block h-[72px] w-[72px]">
                        {x.kind === 'group' ? (
                          <span className="relative block h-full w-full">
                            {x.avatars.slice(0, 2).map((a, i) => (
                              <span key={i} className={`absolute rounded-full ring-2 ring-white ${i === 0 ? 'left-0 top-0' : 'bottom-0 right-0'}`}><Avatar name={a.name} username={a.username} size={46} ring={false} /></span>
                            ))}
                            {x.avatars.length === 0 && <span className="flex h-full w-full items-center justify-center rounded-full bg-zinc-100 text-zinc-600"><Icon name="users" size={30} /></span>}
                          </span>
                        ) : (
                          <Avatar name={x.avatars[0].name} username={x.avatars[0].username} size={72} ring={false} />
                        )}
                        {x.online && <span className="absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full border-[3px] border-white bg-emerald-500" aria-label={tr('Online')} />}
                        {x.recent !== null && <span className="absolute -bottom-1 right-0 rounded-full border-2 border-white bg-emerald-100 px-1.5 text-[11px] font-bold leading-4 text-emerald-700">{x.recent}m</span>}
                        {on && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-brand/70 text-white"><Icon name="check" size={32} strokeWidth={3} /></span>}
                      </span>
                      <span className="line-clamp-2 w-full break-words text-center text-[13px] font-medium leading-tight text-zinc-800">{x.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {note && <p role="status" className="mx-4 mb-1 rounded-xl bg-zinc-50 px-3 py-2 text-center text-sm font-semibold text-zinc-800">{note}</p>}

          {picked.length > 0 ? (
            <div className="shrink-0 border-t border-zinc-100 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder={tr('Escrever uma mensagem…')} aria-label={tr('Mensagem')} className="h-12 w-full rounded-full bg-zinc-100 px-5 text-[16px] outline-none placeholder:text-zinc-500 focus:bg-zinc-200/70" />
              <button type="button" onClick={sendAll} disabled={busy} className="mt-3 h-12 w-full rounded-full bg-brand text-[17px] font-bold text-white transition active:scale-[0.98] disabled:opacity-60">
                {busy ? tr('A enviar…') : picked.length === 1 ? `Enviar a ${picked[0].name.split(' ')[0]}` : `Enviar a ${picked.length} conversas`}
              </button>
            </div>
          ) : (
            <div className="shrink-0 border-t border-zinc-100 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
              <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {action('square-plus', 'Adicionar ao status', () => void toStory('all'), canStory ? tr('bg-brand text-white') : tr('bg-zinc-100 text-zinc-400'))}
                {action('heart', 'Amigos próximos', () => void toStory('close_friends'), canStory ? tr('bg-emerald-500 text-white') : tr('bg-zinc-100 text-zinc-400'))}
                {action('camera', 'Story do WhatsApp', () => void whatsappStory(), 'bg-emerald-500 text-white')}
                {action('messages', 'WhatsApp', whatsapp, 'bg-emerald-600 text-white')}
                {letter('Telegram', 'T', 'bg-sky-500', () => network('telegram', `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(data.text)}`))}
                {letter('Facebook', 'f', 'bg-blue-600', () => network('facebook', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`))}
                {letter('X', 'X', 'bg-zinc-900', () => network('x', `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(data.text)}`))}
                {action('link', 'Copiar link', () => void copy())}
                {typeof navigator.share === 'function' && action('share', 'Partilhar…', () => void system())}
              </div>
            </div>
          )}
        </div>
      </div>
      {preview && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={tr('Pré-visualização do status')}>
          <div className="flex shrink-0 items-center gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-white">
            <button type="button" onClick={() => setPreview(null)} aria-label={tr('Voltar')} className="flex h-11 w-11 items-center justify-center rounded-full active:bg-white/15"><Icon name="back" size={24} /></button>
            <h2 className="text-[17px] font-bold">{tr('Pré-visualização')}</h2>
          </div>
          <div className="relative mx-auto flex min-h-0 w-full max-w-sm flex-1 items-center justify-center px-4">
            <div className="relative aspect-[9/16] max-h-full overflow-hidden rounded-[22px] bg-zinc-900 shadow-2xl">
              {post.media[0]?.kind === 'video' ? (
                <video src={post.media[0].url} poster={post.media[0].posterUrl ?? undefined} className="h-full w-full object-cover" autoPlay muted loop playsInline />
              ) : (
                <img src={post.kind === 'gift' ? (giftUrl ?? undefined) : post.media[0]?.url} alt="" className="h-full w-full object-cover" />
              )}
              <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/55 to-transparent p-3 text-white">
                <Avatar name={post.author.displayName} username={post.author.username} size={30} ring={false} />
                <span className="truncate text-[13px] font-semibold">@{post.author.username}</span>
              </div>
              {caption.trim() && <p className="absolute inset-x-3 bottom-4 rounded-xl bg-black/55 px-3 py-2 text-center text-[16px] font-semibold text-white">{caption}</p>}
            </div>
          </div>
          <div className="shrink-0 space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <input value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 200))} placeholder={tr('Adicionar legenda…')} aria-label={tr('Legenda')} className="h-12 w-full rounded-full bg-white/15 px-5 text-[16px] text-white outline-none placeholder:text-white/60 focus:bg-white/25" />
            <div role="radiogroup" aria-label={tr('Quem vê')} className="grid grid-cols-2 gap-2">
              {([['all', 'Os teus seguidores', 'square-plus'], ['close_friends', 'Amigos próximos', 'heart']] as const).map(([v, label, ic]) => (
                <button key={v} type="button" role="radio" aria-checked={preview === v} onClick={() => setPreview(v)} className={`flex h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold transition ${preview === v ? (v === 'all' ? 'bg-white text-zinc-900' : 'bg-emerald-500 text-white') : 'bg-white/15 text-white'}`}>
                  <Icon name={ic} size={18} /> {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void publishStory()} disabled={busy} className="h-12 w-full rounded-full bg-brand text-[17px] font-bold text-white transition active:scale-[0.98] disabled:opacity-60">{busy ? tr('A partilhar…') : tr('Partilhar no status')}</button>
          </div>
        </div>
      )}
      {grouping && (
        <NewChat
          onClose={() => setGrouping(false)}
          onCreated={(g) => {
            // O grupo acabado de criar entra já escolhido, pronto a receber a publicação.
            setPicked((l) => [...l, { key: `g:${g.id}`, kind: 'group', id: g.id, name: g.name, avatars: [], online: false, recent: null, at: new Date().toISOString() }]);
            void groups.refetch();
          }}
        />
      )}
    </>
  );
}
