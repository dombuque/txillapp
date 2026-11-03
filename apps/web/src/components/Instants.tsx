import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type InstantItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { acquireCamera, releaseCamera } from '../lib/cameraSession';
import { tr } from '../lib/i18n';
import Icon from './Icon';
import { Avatar, Sheet } from './ui';

const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const leftLabel = (iso: string) => {
  const h = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
  return h <= 1 ? tr('acaba daqui a pouco') : tr('acaba daqui a {n} h', { n: h });
};

/**
 * Zás (os Instants): uma foto tirada na hora, com uma legenda curta, que dura 24 h e cada pessoa vê uma só vez.
 * Só chega aos amigos próximos e a quem se segue mutuamente. Fica no canto da caixa de mensagens (como no Instagram):
 * uma pilha de fotos que abre a câmara, onde o obturador envia logo.
 */
export default function InstantsDock() {
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['instants'], queryFn: api.instants, refetchInterval: 60_000 });
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const others = data?.others ?? [];
  const total = others.reduce((n, o) => n + o.count, 0);
  const top = others[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={total ? tr('Zás: {n} por ver', { n: total }) : tr('Mandar um Zás')}
        className="fixed bottom-[calc(6.25rem+env(safe-area-inset-bottom))] right-3 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand to-[#ff9a5b] text-white shadow-[0_4px_14px_rgba(214,51,79,0.5)] ring-2 ring-white active:scale-90"
      >
        {top ? (
          <span className="rounded-full bg-white p-[2px]"><Avatar name={top.displayName} username={top.hasAvatar ? top.username : undefined} size={34} ring={false} /></span>
        ) : (
          <Icon name="bolt" size={24} fill="currentColor" />
        )}
        {top && <span className="absolute -bottom-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white ring-2 ring-white"><Icon name="bolt" size={11} fill="currentColor" /></span>}
        {total > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-[11px] font-bold text-white ring-2 ring-white">{total > 9 ? '9+' : total}</span>}
      </button>
      {open && <InstantsHub onClose={() => setOpen(false)} />}
    </>
  );
}

const INTRO_KEY = 'tx_instants_intro';
const seenIntro = () => {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
};

/** A câmara dos Instants: sem galeria nem edição; a legenda escreve-se antes e o obturador envia logo (com 6 s para desfazer). */
function InstantsHub({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['instants'], queryFn: api.instants, refetchInterval: 30_000 });
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState(false);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // id do último Instant, para desfazer
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const [grid, setGrid] = useState(false);
  // A explicação só aparece da primeira vez.
  const [intro, setIntro] = useState(() => !seenIntro());
  const [viewing, setViewing] = useState<{ username: string; displayName: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['instants'] });
  const others = data?.others ?? [];

  useEffect(() => {
    let dead = false;
    setReady(false);
    setProblem(false);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('sem câmara');
        const s = await acquireCamera(facing, false);
        if (dead) return;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        if (!dead) setProblem(true);
      }
    })();
    return () => {
      dead = true;
    };
  }, [facing]);
  useEffect(() => () => { releaseCamera(2_000); clearTimeout(undoTimer.current); }, []);

  async function shoot() {
    const v = video.current;
    if (!v || !ready || !v.videoWidth || busy) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    navigator.vibrate?.(15);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    setBusy(true);
    setErr('');
    try {
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) throw new Error(tr('Não consegui tirar a foto'));
      const mediaId = await api.uploadChatFile(new File([blob], `instant-${Date.now()}.jpg`, { type: 'image/jpeg' }), 'image/jpeg');
      const r = await api.instantCreate(mediaId, caption.trim());
      setCaption('');
      setSent(r.id);
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setSent(null), 6000);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  async function undo() {
    if (!sent) return;
    const id = sent;
    setSent(null);
    await api.instantDelete(id).catch(() => undefined);
    refresh();
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={tr('Tirar um Instant')} className="fixed inset-0 z-[90] flex flex-col bg-zinc-950 text-white">
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label={tr('Fechar')} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 active:scale-90"><Icon name="x" size={24} /></button>
        <span className="flex -rotate-2 items-center gap-1 rounded-full bg-gradient-to-r from-brand to-[#ff9a5b] px-3.5 py-1 text-[17px] font-black italic tracking-tight shadow-[0_3px_12px_rgba(255,107,107,0.5)]"><Icon name="bolt" size={16} fill="currentColor" /> Zás!</span>
        <button type="button" onClick={() => setGrid(true)} aria-label={tr('Os meus Zás')} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 active:scale-90"><Icon name="grid" size={22} /></button>
      </div>

      <div className="relative mx-auto mt-3 aspect-[3/4] w-[min(88vw,420px)] max-h-[58dvh] overflow-hidden rounded-[30px] bg-black ring-4 ring-white shadow-[0_0_44px_rgba(255,107,107,0.35)]">
        <video ref={video} playsInline muted className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${ready ? '' : 'invisible'}`} />
        {!ready && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-white/80">{problem ? tr('Não consegui abrir a câmara. Os Zás só se mandam na hora.') : tr('A acordar a câmara…')}</p>}
        {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}
        {caption && <p className="absolute inset-x-3 bottom-3 rounded-2xl bg-black/55 px-3 py-2 text-center text-[17px] font-bold leading-snug backdrop-blur-sm">{caption}</p>}
        <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label={tr('Virar câmara')} className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 active:scale-90"><Icon name="flip-camera" size={22} /></button>
      </div>

      <div className="mx-auto mt-3 w-[min(88vw,420px)]">
        <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={80} placeholder={tr('Uma legenda curta (antes da foto)')} aria-label={tr('Legenda')} className="h-11 w-full rounded-full bg-white/15 px-4 text-center text-[16px] outline-none placeholder:text-white/60 focus:bg-white/25" />
        {err && <p role="alert" className="mt-2 text-center text-sm text-red-300">{err}</p>}
      </div>

      {others.length > 0 && (
        <div className="mx-auto mt-3 flex w-[min(88vw,420px)] gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {others.map((o) => (
            <button key={o.username} type="button" onClick={() => setViewing({ username: o.username, displayName: o.displayName })} aria-label={tr('Ver os Zás de {v0}', { v0: o.displayName })} className="flex w-14 shrink-0 flex-col items-center gap-1 active:scale-95">
              <span className="rounded-2xl bg-gradient-to-br from-brand to-amber-400 p-[2.5px]"><span className="flex rounded-[13px] bg-white p-0.5"><Avatar name={o.displayName} username={o.hasAvatar ? o.username : undefined} size={40} ring={false} /></span></span>
              <span className="w-full truncate text-center text-[11px] text-white/80">{o.displayName.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative mt-auto flex items-center justify-center pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-4">
        <button type="button" onClick={shoot} disabled={!ready || busy} aria-label={tr('Tirar e enviar')} className="flex h-[84px] w-[84px] items-center justify-center rounded-full border-[5px] border-white transition active:scale-90 disabled:opacity-50">
          <span className={`flex h-[62px] w-[62px] items-center justify-center rounded-full ${busy ? 'animate-pulse bg-brand text-white' : 'bg-white text-brand'}`}><Icon name="bolt" size={30} fill="currentColor" /></span>
        </button>
        {sent && (
          <div role="status" className="absolute inset-x-4 -top-2 mx-auto flex max-w-sm -translate-y-full items-center justify-between rounded-full bg-white py-2 pl-4 pr-2 text-zinc-900 shadow-[0_4px_18px_rgba(0,0,0,0.4)]">
            <span className="text-[14px] font-semibold">{tr('Zás enviado!')}</span>
            <button type="button" onClick={undo} className="h-9 rounded-full bg-zinc-100 px-4 text-sm font-bold active:scale-95">{tr('Desfazer')}</button>
          </div>
        )}
      </div>

      {intro && (
        <div role="dialog" aria-modal="true" aria-label="Zás" className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 px-6">
          <div className="w-full max-w-sm rounded-[28px] bg-white p-6 text-zinc-900 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white"><Icon name="sparkles" size={28} /></span>
            <h2 className="mt-3 text-center text-2xl font-extrabold tracking-tight">{tr('Zás!')}</h2>
            <p className="mt-1 text-center text-[15px] font-semibold text-zinc-600">{tr('Tirou, mandou, já foi.')}</p>
            <ul className="mt-4 space-y-3 text-[15px] leading-snug">
              {([
                ['camera', tr('Uma foto tirada na hora. Sem galeria e sem filtros.')],
                ['send', tr('O botão envia logo. Tens 6 segundos para desfazer.')],
                ['eye', tr('Cada pessoa vê uma só vez e depois desaparece.')],
                ['clock', tr('Dura 24 horas.')],
                ['users', tr('Só os teus amigos próximos e quem se segue contigo veem.')],
              ] as const).map(([ic, text]) => (
                <li key={ic} className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100"><Icon name={ic} size={18} /></span>{text}</li>
              ))}
            </ul>
            <button type="button" onClick={() => { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* sem armazenamento: volta a aparecer */ } setIntro(false); }} className="mt-5 h-12 w-full rounded-full bg-brand font-bold text-white active:scale-[0.98]">{tr('Percebi')}</button>
          </div>
        </div>
      )}
      {grid && user && <MyInstants username={user.username} onClose={() => { setGrid(false); refresh(); }} />}
      {viewing && <InstantViewer who={viewing} own={false} onClose={() => { setViewing(null); refresh(); }} />}
    </div>,
    document.body,
  );
}

/** Grelha dos meus Instants ativos (24 h): quantas pessoas viram cada um e apagar (com confirmação). */
function MyInstants({ username, onClose }: { username: string; onClose: () => void }) {
  const [items, setItems] = useState<InstantItem[] | null>(null);
  const [err, setErr] = useState('');
  const [del, setDel] = useState<InstantItem | null>(null);
  const [viewers, setViewers] = useState<{ username: string; displayName: string; hasAvatar: boolean; at: string }[] | null>(null);

  useEffect(() => {
    api.instantsOf(username).then(setItems).catch((e) => setErr((e as Error).message));
  }, [username]);

  async function confirmDelete() {
    if (!del) return;
    const id = del.id;
    setDel(null);
    try {
      await api.instantDelete(id);
      setItems((l) => (l ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function showViewers(it: InstantItem) {
    try {
      setViewers(await api.instantViewers(it.id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Sheet title={tr('Os meus Instants')} onClose={onClose} layer="z-[95]">
      {err && <p role="alert" className="pb-2 text-sm text-red-600">{err}</p>}
      {items === null ? (
        <p className="py-8 text-center text-zinc-500">{tr('A carregar…')}</p>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-zinc-600">{tr('Não tens Zás ativos. Os Zás duram 24 h.')}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {items.map((it) => (
            <li key={it.id} className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-zinc-100">
              <img src={it.url} alt={it.caption || 'Zás'} loading="lazy" draggable={false} className="h-full w-full object-cover" />
              <button type="button" onClick={() => showViewers(it)} aria-label={tr('Quem viu')} className="absolute bottom-1.5 left-1.5 flex h-7 items-center gap-1 rounded-full bg-black/60 px-2 text-xs font-bold text-white"><Icon name="eye" size={13} /> {it.views ?? 0}</button>
              <button type="button" onClick={() => setDel(it)} aria-label={tr('Apagar Zás')} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white active:scale-90"><Icon name="trash" size={15} /></button>
              <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">{hm(it.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {del && (
        <Sheet title={tr('Apagar o Zás?')} onClose={() => setDel(null)} layer="z-[100]">
          <p className="mb-4 text-zinc-600">{tr('Desaparece para toda a gente e não dá para o recuperar.')}</p>
          <button onClick={confirmDelete} className="h-12 w-full rounded-full bg-red-700 font-bold text-white active:scale-[0.98]">{tr('Apagar')}</button>
          <button onClick={() => setDel(null)} className="mt-2 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">{tr('Cancelar')}</button>
        </Sheet>
      )}
      {viewers && (
        <Sheet title={tr('Quem viu')} onClose={() => setViewers(null)} layer="z-[100]">
          {viewers.length === 0 ? (
            <p className="py-6 text-center text-zinc-600">{tr('Ainda ninguém viu.')}</p>
          ) : (
            <ul>
              {viewers.map((v) => (
                <li key={v.username} className="flex items-center gap-3 py-2">
                  <Avatar name={v.displayName} username={v.hasAvatar ? v.username : undefined} size={40} ring={false} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{v.displayName}</span><span className="block text-sm text-zinc-500">@{v.username} · {hm(v.at)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </Sheet>
  );
}

/** Ver os Instants de alguém: cada um abre-se uma só vez. Toca à direita para o seguinte, à esquerda para o anterior. */
function InstantViewer({ who, own, onClose }: { who: { username: string; displayName: string }; own: boolean; onClose: () => void }) {
  const [items, setItems] = useState<InstantItem[] | null>(null);
  const [i, setI] = useState(0);
  const [viewers, setViewers] = useState<{ username: string; displayName: string; hasAvatar: boolean; at: string }[] | null>(null);
  const [err, setErr] = useState('');
  const marked = useRef(new Set<string>());

  useEffect(() => {
    api.instantsOf(who.username).then((r) => (r.length ? setItems(r) : onClose())).catch((e) => setErr((e as Error).message));
  }, [who.username]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = items?.[i];
  // Ao aparecer, conta como visto (e some da faixa).
  useEffect(() => {
    if (own || !cur || marked.current.has(cur.id)) return;
    marked.current.add(cur.id);
    api.instantView(cur.id).catch(() => undefined);
  }, [cur, own]);

  function next() {
    if (!items) return;
    if (i + 1 >= items.length) onClose();
    else setI(i + 1);
  }
  async function remove() {
    if (!cur) return;
    try {
      await api.instantDelete(cur.id);
      const rest = items!.filter((x) => x.id !== cur.id);
      if (!rest.length) return onClose();
      setItems(rest);
      setI(Math.min(i, rest.length - 1));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function showViewers() {
    if (!cur) return;
    try {
      setViewers(await api.instantViewers(cur.id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Zás de ${who.displayName}`} className="fixed inset-0 z-[90] flex flex-col bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-white">
      <div className="flex gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]" aria-hidden>
        {(items ?? [{ id: 'x' }]).map((x, k) => <span key={x.id} className={`h-1 flex-1 rounded-full ${k <= i ? 'bg-white' : 'bg-white/30'}`} />)}
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar name={who.displayName} username={who.username} size={36} ring={false} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold leading-tight">{own ? tr('Os teus Zás') : who.displayName}</span>
          {cur && <span className="block text-xs text-white/70">{hm(cur.at)} · {leftLabel(cur.expiresAt)}</span>}
        </span>
        <button type="button" onClick={onClose} aria-label={tr('Fechar')} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 active:scale-90"><Icon name="x" size={22} /></button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-5 pb-2">
        {cur ? (
          <figure className="relative w-full max-w-sm rotate-[-1.2deg] rounded-[26px] bg-white p-3 pb-4 shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
            <span className="absolute -top-3 left-6 z-10 flex rotate-[-5deg] items-center gap-1 rounded-md bg-gradient-to-r from-brand to-[#ff9a5b] px-2.5 py-0.5 text-sm font-black italic text-white shadow-md"><Icon name="bolt" size={13} fill="currentColor" /> Zás!</span>
            <img src={cur.url} alt={cur.caption || tr('Zás')} draggable={false} className="aspect-[3/4] max-h-[62dvh] w-full rounded-[18px] object-cover" />
            {cur.caption && <figcaption className="mt-3 px-1 text-center text-[19px] font-extrabold leading-snug text-zinc-900">{cur.caption}</figcaption>}
          </figure>
        ) : (
          <p className="text-white/70">{err || tr('A carregar…')}</p>
        )}
        {/* Metades do ecrã: anterior / seguinte. */}
        <button type="button" aria-label={tr('Anterior')} onClick={() => setI((k) => Math.max(0, k - 1))} className="absolute inset-y-0 left-0 w-1/3" />
        <button type="button" aria-label={tr('Seguinte')} onClick={next} className="absolute inset-y-0 right-0 w-2/3" />
      </div>

      <div className="flex items-center justify-center gap-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
        {own ? (
          <>
            <button type="button" onClick={showViewers} className="flex h-11 items-center gap-2 rounded-full bg-white/15 px-5 font-semibold active:scale-95"><Icon name="eye" size={18} /> {tr('{n} viram', { n: cur?.views ?? 0 })}</button>
            <button type="button" onClick={remove} aria-label={tr('Apagar Instant')} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-red-300 active:scale-95"><Icon name="trash" size={20} /></button>
          </>
        ) : (
          <span aria-hidden className="h-11" />
        )}
      </div>

      {viewers && (
        <Sheet title={tr('Quem viu')} onClose={() => setViewers(null)} layer="z-[95]">
          {viewers.length === 0 ? (
            <p className="py-6 text-center text-zinc-600">{tr('Ainda ninguém viu.')}</p>
          ) : (
            <ul>
              {viewers.map((v) => (
                <li key={v.username} className="flex items-center gap-3 py-2">
                  <Avatar name={v.displayName} username={v.hasAvatar ? v.username : undefined} size={40} ring={false} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{v.displayName}</span><span className="block text-sm text-zinc-500">@{v.username} · {hm(v.at)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </div>,
    document.body,
  );
}
