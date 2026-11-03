import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type InstantItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { acquireCamera, releaseCamera } from '../lib/cameraSession';
import { tr } from '../lib/i18n';
import Icon from './Icon';
import { REACTIONS, Reaction } from '../lib/stickers';
import { markSeen } from '../lib/whatsNew';
import { NewBadge } from './WhatsNew';
import CloseFriendsSheet from './CloseFriendsSheet';
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
  const qc = useQueryClient();
  // O normal é ver os Zás dos outros; a câmara abre logo se não há nenhum por ver (ou ao tocar na câmara / no fim da fila).
  const [mode, setMode] = useState<null | 'view' | 'cam'>(null);
  const [queue, setQueue] = useState<{ username: string; displayName: string }[]>([]);
  const [at, setAt] = useState(0);
  if (!user) return null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['instants'] });
  const others = data?.others ?? [];
  const total = others.reduce((n, o) => n + o.count, 0);
  const top = others[0];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          markSeen('zas');
          if (others.length) {
            setQueue(others.map((o) => ({ username: o.username, displayName: o.displayName })));
            setAt(0);
            setMode('view');
          } else setMode('cam');
        }}
        aria-label={total ? tr('Zás: {n} por ver', { n: total }) : tr('Mandar um Zás')}
        className="fixed bottom-[calc(6.25rem+env(safe-area-inset-bottom))] right-3 z-20 flex h-[60px] w-12 items-center justify-center rounded-[20px] bg-gradient-to-br from-brand to-[#ff9a5b] text-white shadow-[0_4px_14px_rgba(214,51,79,0.5)] ring-2 ring-white active:scale-90"
      >
        {top ? (
          <>
            {/* Miniatura minúscula e desfocada feita pelo servidor: dá a ideia sem mostrar a foto (só se vê uma vez). */}
            {top.preview && <img src={top.preview} alt="" draggable={false} className="absolute inset-0 h-full w-full scale-110 rounded-[inherit] object-cover blur-[2px]" />}
            <span className="absolute inset-0 rounded-[inherit] bg-black/15" />
            <span className="absolute -bottom-1.5 -left-1.5 rounded-full bg-white p-[2px] shadow"><Avatar name={top.displayName} username={top.hasAvatar ? top.username : undefined} size={26} ring={false} /></span>
            <span className="absolute inset-0 flex items-center justify-center"><Icon name="bolt" size={22} fill="currentColor" className="drop-shadow" /></span>
          </>
        ) : (
          <Icon name="bolt" size={24} fill="currentColor" />
        )}
        <NewBadge id="zas" className="absolute -left-4 -top-3" />
        {total > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-[11px] font-bold text-white ring-2 ring-white">{total > 9 ? '9+' : total}</span>}
      </button>
      {mode === 'cam' && <InstantsHub onClose={() => { setMode(null); refresh(); }} />}
      {mode === 'view' && queue[at] && (
        <InstantViewer
          key={queue[at].username}
          who={queue[at]}
          own={false}
          onClose={() => { setMode(null); refresh(); }}
          onCamera={() => setMode('cam')}
          onFinish={() => (at + 1 < queue.length ? setAt(at + 1) : setMode('cam'))}
        />
      )}
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

const AUDIENCE_KEY = 'tx_zas_audience';
type Audience = 'friends' | 'close';
const readAudience = (): Audience => {
  try {
    return localStorage.getItem(AUDIENCE_KEY) === 'close' ? 'close' : 'friends';
  } catch {
    return 'friends';
  }
};

/**
 * A câmara dos Zás (como a dos Instants do Instagram): a ecrã cheio, sem galeria nem edição. No canto de cima, a pilha de quem te
 * mandou um Zás e a grelha dos teus; em baixo a legenda, o obturador (envia logo, com 6 s para desfazer) e para quem vai.
 */
function InstantsHub({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['instants'], queryFn: api.instants, refetchInterval: 30_000 });
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState(false);
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<Audience>(readAudience);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // id do último Zás, para desfazer
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const [grid, setGrid] = useState(false);
  // A explicação só aparece da primeira vez.
  const [intro, setIntro] = useState(() => !seenIntro());
  // Ver os Zás dos outros, um de cada vez, em fila.
  const [queue, setQueue] = useState<{ username: string; displayName: string }[] | null>(null);
  const [at, setAt] = useState(0);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['instants'] });
  const friendsList = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });
  const [setupClose, setSetupClose] = useState(false);
  const others = data?.others ?? [];
  const total = others.reduce((n, o) => n + o.count, 0);

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

  function pickAudience(a: Audience) {
    // Sem amigos próximos ainda: abre já a lista para os escolher.
    if (a === 'close' && friendsList.isSuccess && friendsList.data.length === 0) setSetupClose(true);
    setAudience(a);
    try {
      localStorage.setItem(AUDIENCE_KEY, a);
    } catch {
      /* sem armazenamento: só não se lembra da escolha */
    }
  }
  async function shoot() {
    const v = video.current;
    if (!v || !ready || !v.videoWidth || busy) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d')!;
    // Selfie: a foto sai como a viste no ecrã (espelhada).
    if (facing === 'user') {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, 0, 0);
    navigator.vibrate?.(15);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    setBusy(true);
    setErr('');
    try {
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) throw new Error(tr('Não consegui tirar a foto'));
      const mediaId = await api.uploadChatFile(new File([blob], `instant-${Date.now()}.jpg`, { type: 'image/jpeg' }), 'image/jpeg');
      const r = await api.instantCreate(mediaId, caption.trim(), audience);
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

  const small = 'flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition active:scale-90';
  const recent = others.slice(0, 3);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={tr('Mandar um Zás')} className="fixed inset-0 z-[90] flex flex-col bg-[#08080b] text-white" style={{ background: 'radial-gradient(120% 60% at 50% 105%, rgba(255,92,92,.28), transparent 60%), #08080b' }}>
      {/* Em cima, sobre o preto: fechar, o nome e os teus Zás. */}
      <div className="flex shrink-0 items-center justify-between px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label={tr('Fechar')} className={small}><Icon name="x" size={26} /></button>
        <span className="flex items-center gap-1.5 text-[22px] font-black italic tracking-tight"><Icon name="bolt" size={20} fill="currentColor" className="text-brand" /> Zás</span>
        <button type="button" onClick={() => setGrid(true)} aria-label={tr('Os meus Zás')} className={small}><Icon name="grid" size={23} /></button>
      </div>

      {/* A câmara: um cartão 3:4 de cantos bem redondos. A legenda fica dentro, afastada das curvas. */}
      <div className="relative mx-auto flex min-h-0 w-full flex-1 items-center justify-center px-8 py-2">
        <div className="relative h-full max-h-[440px] overflow-hidden rounded-[44px] bg-zinc-900 ring-1 ring-white/15 shadow-[0_20px_60px_-10px_rgba(255,92,92,0.35)]" style={{ aspectRatio: '3 / 4', maxWidth: '100%' }}>
          <video ref={video} playsInline muted className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${ready ? '' : 'invisible'}`} />
          {!ready && <p className="absolute inset-0 flex items-center justify-center px-12 text-center text-white/80">{problem ? tr('Não consegui abrir a câmara. Os Zás só se mandam na hora.') : tr('A acordar a câmara…')}</p>}
          {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/45 to-transparent" />
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={80}
            placeholder={tr('Adicionar legenda…')}
            aria-label={tr('Legenda')}
            className="absolute inset-x-5 bottom-4 h-11 rounded-full bg-black/35 px-5 text-center text-[16px] font-semibold outline-none ring-1 ring-white/15 backdrop-blur-md placeholder:text-white/75 focus:bg-black/50"
          />
          {err && <p role="alert" className="absolute inset-x-8 top-6 rounded-[22px] bg-red-600/90 px-4 py-2 text-center text-sm font-semibold">{err}</p>}
        </div>
      </div>

      {/* Em baixo: quem te mandou, o obturador e virar a câmara; depois, para quem vai. */}
      <div className="relative shrink-0 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {sent && (
          <div role="status" className="absolute inset-x-6 top-0 mx-auto flex max-w-sm -translate-y-[calc(100%+4px)] items-center justify-between rounded-full bg-white py-2 pl-5 pr-2 text-zinc-900">
            <span className="text-[15px] font-bold">{tr('Zás enviado!')}</span>
            <button type="button" onClick={undo} className="h-9 rounded-full bg-zinc-100 px-4 text-sm font-bold active:scale-95">{tr('Desfazer')}</button>
          </div>
        )}
        <div className="mx-auto flex max-w-[360px] items-center justify-between">
          {total > 0 ? (
            <button type="button" onClick={() => { setQueue(others); setAt(0); }} aria-label={tr('Zás: {n} por ver', { n: total })} className="relative h-14 w-14 active:scale-90">
              {[...recent].reverse().map((o, k) => {
                const i = recent.length - 1 - k;
                return (
                  <span key={o.username} className="absolute left-0 top-0 rounded-[18px] bg-white p-[2px] shadow-md" style={{ transform: `translate(${i * 5}px, ${i * -5}px) rotate(${i % 2 ? 5 : -4}deg)` }}>
                    <Avatar name={o.displayName} username={o.hasAvatar ? o.username : undefined} size={46} ring={false} />
                  </span>
                );
              })}
              <span className="absolute -right-1 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-extrabold text-white ring-2 ring-black">{total > 9 ? '9+' : total}</span>
            </button>
          ) : (
            <span className="h-14 w-14" />
          )}
          <button type="button" onClick={shoot} disabled={!ready || busy} aria-label={tr('Tirar e enviar')} className="relative flex h-[86px] w-[86px] items-center justify-center rounded-full transition active:scale-90 disabled:opacity-50">
            <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_200deg,#ff5c5c,#ff9a5b,#ffd166,#ff5c5c)] p-[4px]"><span className="block h-full w-full rounded-full bg-[#08080b]" /></span>
            <span className={`relative flex h-[66px] w-[66px] items-center justify-center rounded-full shadow-[0_6px_20px_rgba(255,92,92,0.45)] ${busy ? 'animate-pulse bg-brand text-white' : 'bg-white text-brand'}`}><Icon name="bolt" size={30} fill="currentColor" /></span>
          </button>
          <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label={tr('Virar câmara')} className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 backdrop-blur active:scale-90"><Icon name="flip-camera" size={25} /></button>
        </div>
        {/* Para quem vai: amigos (próximos e mútuos) ou só os amigos próximos. */}
        <div role="radiogroup" aria-label={tr('Para quem vai')} className="mx-auto mt-5 flex w-fit rounded-full bg-white/10 p-1 text-[14px] font-bold backdrop-blur">
          {([['friends', tr('Amigos')], ['close', tr('Próximos')]] as const).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={audience === id} onClick={() => pickAudience(id)} className={`flex items-center gap-1.5 rounded-full px-6 py-2 transition ${audience === id ? (id === 'close' ? 'bg-emerald-500 text-white' : 'bg-white text-zinc-900') : 'text-white/70'}`}>
              {id === 'close' && <span className={`h-2 w-2 rounded-full ${audience === id ? 'bg-white' : 'bg-emerald-400'}`} aria-hidden />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {intro && (
        <div role="dialog" aria-modal="true" aria-label="Zás" className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 px-6">
          <div className="w-full max-w-sm rounded-[36px] bg-white p-6 text-zinc-900 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white"><Icon name="bolt" size={28} fill="currentColor" /></span>
            <h2 className="mt-3 text-center text-2xl font-extrabold tracking-tight">{tr('Zás!')}</h2>
            <p className="mt-1 text-center text-[15px] font-semibold text-zinc-600">{tr('Tirou, mandou, já foi.')}</p>
            <ul className="mt-4 space-y-3 text-[15px] leading-snug">
              {([
                ['camera', tr('Uma foto tirada na hora. Sem galeria e sem filtros.')],
                ['send', tr('O botão envia logo. Tens 6 segundos para desfazer.')],
                ['eye', tr('Cada pessoa vê uma só vez e depois desaparece.')],
                ['clock', tr('Dura 24 horas.')],
                ['users', tr('Vai para os teus amigos (quem se segue contigo) ou só para os Próximos.')],
              ] as const).map(([ic, text]) => (
                <li key={ic} className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100"><Icon name={ic} size={18} /></span>{text}</li>
              ))}
            </ul>
            <button type="button" onClick={() => { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* sem armazenamento: volta a aparecer */ } setIntro(false); }} className="mt-5 h-12 w-full rounded-full bg-brand font-bold text-white active:scale-[0.98]">{tr('Percebi')}</button>
          </div>
        </div>
      )}
      {setupClose && (
        <CloseFriendsSheet
          layer="z-[100]"
          onClose={async () => {
            setSetupClose(false);
            const r = await friendsList.refetch();
            // Se continua sem ninguém, "Próximos" não faria sentido: volta a "Amigos".
            if (!r.data?.length) pickAudience('friends');
          }}
        />
      )}
      {grid && user && <MyInstants username={user.username} onClose={() => { setGrid(false); refresh(); }} />}
      {queue && queue[at] && (
        <InstantViewer
          key={queue[at].username}
          who={queue[at]}
          own={false}
          onClose={() => { setQueue(null); refresh(); }}
          onFinish={() => (at + 1 < queue.length ? setAt(at + 1) : (setQueue(null), refresh()))}
        />
      )}
    </div>,
    document.body,
  );
}

/** Forma "squircle" dos Zás (cantos muito redondos e lados ligeiramente abaulados), como as fotos dos Instants. */
const SQUIRCLE_POINTS = (() => {
  const n = 3.4;
  const pts: string[] = [];
  for (let i = 0; i < 90; i++) {
    const t = (i / 90) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push(`${(0.5 + 0.5 * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(4)},${(0.5 + 0.5 * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(4)}`);
  }
  return pts.join(' ');
})();
const SQUIRCLE = { clipPath: 'url(#zas-squircle)', WebkitClipPath: 'url(#zas-squircle)' } as const;
function SquircleDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        <clipPath id="zas-squircle" clipPathUnits="objectBoundingBox"><polygon points={SQUIRCLE_POINTS} /></clipPath>
      </defs>
    </svg>
  );
}
const hoursLeft = (iso: string) => `${Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000))}h`;

/** Os meus Zás ativos (24 h) numa grelha de 3 colunas em formas arredondadas; a reação mais comum aparece no canto. Toca para abrir (e apagar). */
function MyInstants({ username, onClose }: { username: string; onClose: () => void }) {
  const [items, setItems] = useState<InstantItem[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [del, setDel] = useState<InstantItem | null>(null);
  const [menu, setMenu] = useState<InstantItem | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const held = useRef(false);

  // Guardar na galeria / partilhar: no telemóvel abre a folha de partilha (com "Guardar imagem"); no computador descarrega o ficheiro.
  async function photoOf(it: InstantItem) {
    const b = await (await fetch(it.url)).blob();
    return new File([b], `zas-${it.id.slice(0, 8)}.jpg`, { type: b.type || 'image/jpeg' });
  }
  async function save(it: InstantItem) {
    setMenu(null);
    try {
      const f = await photoOf(it);
      if (navigator.canShare?.({ files: [f] })) return void (await navigator.share({ files: [f] }));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') window.open(it.url, '_blank');
    }
  }
  async function share(it: InstantItem) {
    setMenu(null);
    try {
      const f = await photoOf(it);
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text: it.caption || undefined });
      else await navigator.clipboard?.writeText(it.caption || '');
    } catch {
      /* cancelado: nada a fazer */
    }
  }

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

  const load = () => api.instantsOf(username).then(setItems).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, [username]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={tr('Os meus Zás')} className="fixed inset-0 z-[95] flex flex-col bg-black text-white">
      <SquircleDefs />
      <div className="relative flex shrink-0 items-center justify-center px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label={tr('Voltar')} className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full active:scale-90"><Icon name="chevron-left" size={26} /></button>
        <h2 className="text-[18px] font-extrabold">{tr('Os meus Zás')}</h2>
      </div>
      {err && <p role="alert" className="px-4 pb-2 text-center text-sm text-red-400">{err}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-28">
        {items === null ? (
          <p className="py-16 text-center text-white/60">{tr('A carregar…')}</p>
        ) : items.length === 0 ? (
          <p className="px-8 py-16 text-center text-white/70">{tr('Não tens Zás ativos. Os Zás duram 24 h.')}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {items.map((it) => {
              const top = it.reactions?.[0];
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => { if (held.current) { held.current = false; return; } setOpen(it.id); }}
                    onPointerDown={() => { held.current = false; hold.current = setTimeout(() => { held.current = true; navigator.vibrate?.(15); setMenu(it); }, 450); }}
                    onPointerUp={() => clearTimeout(hold.current)}
                    onPointerLeave={() => clearTimeout(hold.current)}
                    onPointerCancel={() => clearTimeout(hold.current)}
                    onContextMenu={(e) => { e.preventDefault(); held.current = true; setMenu(it); }}
                    aria-label={it.caption || tr('Zás')}
                    className="relative block aspect-[3/4] w-full select-none bg-zinc-800 transition active:scale-[0.97] active:opacity-80 [-webkit-touch-callout:none]"
                    style={SQUIRCLE}
                  >
                    <img src={it.url} alt="" loading="lazy" draggable={false} className="pointer-events-none h-full w-full select-none object-cover [-webkit-touch-callout:none]" />
                    <span className="absolute right-[13%] top-[9%] flex items-center gap-0.5 text-[13px] font-bold drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                      {top ? (
                        <>
                          <Reaction body={top.reaction} size={20} />
                          {(it.reactions ?? []).reduce((n, r) => n + r.count, 0)}
                        </>
                      ) : (
                        <><Icon name="eye" size={14} />{it.views ?? 0}</>
                      )}
                    </span>
                    <span className="absolute bottom-[9%] right-[13%] rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold">{hoursLeft(it.expiresAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {/* Botão flutuante: voltar à câmara para mandar outro. */}
      <button type="button" onClick={onClose} className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 flex h-14 -translate-x-1/2 items-center gap-2 rounded-full bg-white px-7 text-[17px] font-bold text-zinc-900 shadow-[0_6px_24px_rgba(0,0,0,0.5)] active:scale-95"><Icon name="bolt" size={20} fill="currentColor" className="text-brand" />{tr('Mandar um Zás')}</button>
      {menu && (
        <Sheet title={tr('Zás')} onClose={() => setMenu(null)} layer="z-[100]">
          {([
            ['download', tr('Guardar na galeria'), tr('Fica no teu telemóvel.'), () => void save(menu), false],
            ['share', tr('Partilhar'), tr('Manda a foto a quem quiseres.'), () => void share(menu), false],
            ['trash', tr('Apagar'), tr('Desaparece para toda a gente.'), () => { setDel(menu); setMenu(null); }, true],
          ] as const).map(([ic, label, text, run, danger]) => (
            <button key={label} onClick={run} className={`flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left transition ${danger ? 'text-red-700 active:bg-red-50' : 'active:bg-zinc-100'}`}>
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-red-50' : 'bg-zinc-100 text-zinc-800'}`}><Icon name={ic} /></span>
              <span><span className="block text-[17px] font-semibold">{label}</span><span className="block text-sm text-zinc-600">{text}</span></span>
            </button>
          ))}
        </Sheet>
      )}
      {del && (
        <Sheet title={tr('Apagar o Zás?')} onClose={() => setDel(null)} layer="z-[100]">
          <p className="mb-4 text-zinc-600">{tr('Desaparece para toda a gente e não dá para o recuperar.')}</p>
          <button onClick={confirmDelete} className="h-12 w-full rounded-full bg-red-700 font-bold text-white active:scale-[0.98]">{tr('Apagar')}</button>
          <button onClick={() => setDel(null)} className="mt-2 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">{tr('Cancelar')}</button>
        </Sheet>
      )}
      {open && <InstantViewer who={{ username, displayName: '' }} own startId={open} onClose={() => { setOpen(null); void load(); }} />}
    </div>,
    document.body,
  );
}

/** Ver os Zás de alguém: foto a ecrã cheio com cantos bem redondos, cada um abre-se uma só vez. Toca à direita para o seguinte e à esquerda para o anterior. */
function InstantViewer({ who, own, onClose, onFinish, onCamera, startId }: { who: { username: string; displayName: string }; own: boolean; onClose: () => void; onFinish?: () => void; onCamera?: () => void; startId?: string }) {
  const [items, setItems] = useState<InstantItem[] | null>(null);
  const [i, setI] = useState(0);
  const [viewers, setViewers] = useState<{ username: string; displayName: string; hasAvatar: boolean; at: string }[] | null>(null);
  const [err, setErr] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const marked = useRef(new Set<string>());
  // Arrastar para baixo fecha (o cartão acompanha o dedo); duplo toque na foto reage com um brinde.
  const [drag, setDrag] = useState(0);
  const touch = useRef<{ x: number; y: number; on: boolean } | null>(null);
  const [pop, setPop] = useState<{ n: number; id: string } | null>(null);
  const tapTimer = useRef<number | null>(null);

  useEffect(() => {
    api.instantsOf(who.username).then((r) => {
      if (!r.length) return (onFinish ?? onClose)();
      setItems(r);
      const at = startId ? r.findIndex((x) => x.id === startId) : -1;
      if (at > 0) setI(at);
    }).catch((e) => setErr((e as Error).message));
  }, [who.username]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = items?.[i];
  // Ao aparecer, conta como visto (e some da faixa).
  useEffect(() => {
    if (own || !cur || marked.current.has(cur.id)) return;
    marked.current.add(cur.id);
    api.instantView(cur.id).catch(() => undefined);
  }, [cur, own]);

  function react(id: string, art: string) {
    if (!cur) return;
    navigator.vibrate?.(8);
    setPop((p) => ({ n: (p?.n ?? 0) + 1, id }));
    api.instantReact(cur.id, id).catch(() => undefined);
    void sendDm({ kind: 'sticker', body: art });
  }
  /** Toque numa metade: vai para o outro Zás; dois toques seguidos reagem com um brinde (e não mudam de Zás). */
  function tapZone(go: () => void) {
    if (own) return go();
    if (tapTimer.current != null) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      react(':brinde:', 'saude');
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      go();
    }, 250);
  }
  const dragProps = {
    onTouchStart: (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, on: false }; },
    onTouchMove: (e: React.TouchEvent) => {
      const t = touch.current;
      if (!t) return;
      const dy = e.touches[0].clientY - t.y;
      const dx = e.touches[0].clientX - t.x;
      if (!t.on && dy > 12 && dy > Math.abs(dx) * 1.5) t.on = true;
      if (t.on) setDrag(Math.max(0, dy));
    },
    onTouchEnd: () => {
      const t = touch.current;
      touch.current = null;
      if (t?.on && drag > 110) onClose();
      setDrag(0);
    },
  };

  function next() {
    if (!items) return;
    if (i + 1 >= items.length) (onFinish ?? onClose)();
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
  // Reações e respostas vão para as mensagens (como no Instagram).
  async function sendDm(msg: { kind: 'sticker' | 'text'; body: string }) {
    setErr('');
    try {
      await api.chatSend(who.username, msg);
      setNote(tr('Enviado para as mensagens'));
      setTimeout(() => setNote(''), 2000);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  function sendReply(e: React.FormEvent) {
    e.preventDefault();
    const body = reply.trim();
    if (!body) return;
    setReply('');
    void sendDm({ kind: 'text', body: `${tr('Sobre o teu Zás')}: ${body}` });
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Zás de ${who.displayName}`} className="fixed inset-0 z-[90] flex flex-col bg-black text-white" style={{ backgroundColor: drag ? `rgba(0,0,0,${Math.max(0.3, 1 - drag / 400)})` : undefined }}>
      <div {...dragProps} className="relative mx-2 mt-[max(0.5rem,env(safe-area-inset-top))] min-h-0 flex-1 overflow-hidden rounded-[40px] bg-zinc-900 ring-1 ring-white/10" style={{ transform: drag ? `translateY(${drag}px) scale(${Math.max(0.85, 1 - drag / 1500)})` : undefined, transition: drag ? 'none' : 'transform .2s ease-out', touchAction: 'pan-x' }}>
        {cur ? <img src={cur.url} alt={cur.caption || tr('Zás')} draggable={false} onContextMenu={(e) => e.preventDefault()} className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover [-webkit-touch-callout:none]" /> : <p className="absolute inset-0 flex items-center justify-center text-white/70">{err || tr('A carregar…')}</p>}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent" />

        {/* Metades do ecrã: anterior / seguinte. */}
        <button type="button" aria-label={tr('Anterior')} onClick={() => tapZone(() => setI((k) => Math.max(0, k - 1)))} className="absolute inset-y-16 left-0 w-1/3" />
        <button type="button" aria-label={tr('Seguinte')} onClick={() => tapZone(next)} className="absolute inset-y-16 right-0 w-2/3" />
        {pop && <span key={pop.n} aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center opacity-0 animate-[burst_.9s_ease-out_forwards]"><Reaction body={pop.id} size={120} /></span>}

        <div className="absolute inset-x-6 top-4 flex gap-1" aria-hidden>
          {(items ?? [{ id: 'x' }]).map((x, k) => <span key={x.id} className={`h-1 flex-1 rounded-full ${k <= i ? 'bg-white' : 'bg-white/35'}`} />)}
        </div>
        <div className="absolute inset-x-5 top-8 flex items-center gap-3">
          <Avatar name={who.displayName} username={who.username} size={38} ring={false} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-bold leading-tight drop-shadow">{own ? tr('Os teus Zás') : who.displayName}</span>
            {cur && <span className="block text-xs text-white/80 drop-shadow">{hm(cur.at)} · {leftLabel(cur.expiresAt)}</span>}
          </span>
          {onCamera ? (
            <button type="button" onClick={onCamera} aria-label={tr('Mandar o meu Zás')} className="flex h-10 items-center gap-1.5 rounded-full bg-brand pl-3 pr-3.5 text-[13px] font-black italic active:scale-90"><Icon name="camera" size={16} />{tr('O meu')}</button>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[12px] font-black italic"><Icon name="bolt" size={12} fill="currentColor" />Zás</span>
          )}
          <button type="button" onClick={onClose} aria-label={tr('Fechar')} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-md active:scale-90"><Icon name="x" size={22} /></button>
        </div>

        {cur?.caption && <p className="absolute inset-x-6 bottom-6 rounded-[26px] bg-black/35 px-5 py-3 text-center text-[19px] font-extrabold leading-snug ring-1 ring-white/15 backdrop-blur-md">{cur.caption}</p>}
        {(err || note) && cur && <p role={err ? 'alert' : 'status'} className={`absolute inset-x-8 top-24 rounded-full px-4 py-2 text-center text-sm font-semibold ${err ? 'bg-red-600/90' : 'bg-emerald-600/90'}`}>{err || note}</p>}
      </div>

      <div className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {own ? (
          <div className="flex items-center justify-center gap-3">
            {!!cur?.reactions?.length && (
              <div className="flex h-12 items-center gap-2 rounded-full bg-white/15 px-4" aria-label={tr('Reações')}>
                {cur.reactions.map((r) => <span key={r.reaction} className="flex items-center gap-0.5 text-[13px] font-bold"><Reaction body={r.reaction} size={24} />{r.count}</span>)}
              </div>
            )}
            <button type="button" onClick={showViewers} className="flex h-12 items-center gap-2 rounded-full bg-white/15 px-6 font-semibold active:scale-95"><Icon name="eye" size={18} /> {tr('{n} viram', { n: cur?.views ?? 0 })}</button>
            <button type="button" onClick={remove} aria-label={tr('Apagar Zás')} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-red-300 active:scale-95"><Icon name="trash" size={20} /></button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex justify-center gap-2" role="group" aria-label={tr('Reagir')}>
              {REACTIONS.map((r) => (
                <button key={r.id} type="button" aria-label={r.label} onClick={() => react(r.id, r.art)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/12 transition active:scale-90"><Reaction body={r.id} size={32} /></button>
              ))}
            </div>
            <form onSubmit={sendReply} className="flex items-center gap-2 rounded-full bg-white/12 p-1.5 pl-5">
              <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={500} placeholder={tr('Responder a {v0}…', { v0: who.displayName.split(' ')[0] })} aria-label={tr('Responder')} className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-white/60" />
              <button type="submit" disabled={!reply.trim()} aria-label={tr('Enviar')} className="flex h-10 w-10 items-center justify-center rounded-full bg-brand disabled:opacity-40 active:scale-90"><Icon name="send" size={18} /></button>
            </form>
          </>
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
