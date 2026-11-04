import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
import FlashIcon from './FlashIcon';
import { renderZasImage } from '../lib/zasImage';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';
import { FUN_FX, createFunRenderer, type FunRenderer } from '../lib/funFilters';
import { Avatar, Sheet, timeAgo } from './ui';

/** Guardar o Zás como está desenhado (foto na moldura, com a legenda): no telemóvel abre a folha de partilha ("Guardar imagem"); no computador descarrega o PNG. */
async function saveInstant(it: { id: string; url: string; caption?: string }) {
  try {
    const f = new File([await renderZasImage(it.url, it.caption ?? '')], `zas-${it.id.slice(0, 8)}.png`, { type: 'image/png' });
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
  // Como o atalho do Instagram: espreita a meio e sai de vez quando a lista pára de mexer.
  const [gridOpen, setGridOpen] = useState(false);
  const [away, setAway] = useState(true);
  useEffect(() => {
    let t = window.setTimeout(() => setAway(false), 500);
    const onScroll = () => {
      setAway(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setAway(false), 900);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.clearTimeout(t);
    };
  }, []);
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
        className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-0 z-20 h-[150px] w-[150px]"
        style={{ transform: away ? 'translateX(66%)' : 'translateX(38%)', transition: 'transform .4s cubic-bezier(.2,.9,.3,1.15)' }}
      >
        {/* Baralho em leque, como no Instagram: as cartas dos Zás por ver (foto desfocada), a da frente com a foto de perfil. */}
        {(others.length ? [...others.slice(0, 3)].reverse() : [null]).map((o, idx, arr) => {
          const depth = arr.length - 1 - idx;
          return (
            <span
              key={o?.username ?? 'vazio'}
              className="absolute bottom-3 right-6 h-[116px] w-[88px] overflow-hidden rounded-[24px] bg-gradient-to-br from-brand to-[#ff9a5b] shadow-[0_6px_16px_rgba(0,0,0,0.3)] ring-[3px] ring-white"
              style={{ transform: `translate(${-depth * 24}px, ${-depth * 9}px) rotate(${-8 - depth * 12}deg)`, transformOrigin: '70% 90%', zIndex: 3 - depth }}
            >
              {o?.preview && <img src={o.preview} alt="" draggable={false} className="absolute inset-0 h-full w-full scale-125 object-cover blur-[3px]" />}
              {depth > 0 && <span className="absolute inset-0 bg-white/15" />}
              {!o && <span className="absolute inset-0 flex items-center justify-center text-white"><Icon name="plus" size={34} strokeWidth={2.6} className="drop-shadow" /></span>}
            </span>
          );
        })}
        {top && <span className="absolute bottom-[100px] right-[78px] z-[5] rounded-full bg-white p-[2px] shadow-md"><Avatar name={top.displayName} username={top.hasAvatar ? top.username : undefined} size={40} ring={false} /></span>}
        <NewBadge id="zas" className="absolute left-0 top-0 z-[6]" />
        {total > 0 && <span className="absolute right-2 top-1 z-[6] flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-[11px] font-bold text-white ring-2 ring-white">{total > 9 ? '9+' : total}</span>}
      </button>
      {gridOpen && <MyInstants username={user.username} onClose={() => setGridOpen(false)} />}
      {mode === 'cam' && <InstantsHub onClose={() => { setMode(null); refresh(); }} />}
      {mode === 'view' && queue[at] && (
        <InstantViewer
          key={queue[at].username}
          who={queue[at]}
          own={false}
          onClose={() => { setMode(null); refresh(); }}
          onCamera={() => setMode('cam')}
          onGrid={() => { setMode(null); setGridOpen(true); }}
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
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState(false);
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<Audience>(readAudience);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // id do último Zás, para desfazer
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const [light, setLight] = useState(false); // flash ligado (lanterna ao vivo, ou ecrã aceso na câmara da frente)
  const [canTorch, setCanTorch] = useState(false);
  const [lit, setLit] = useState(false); // ecrã aceso (flash da câmara da frente)
  const [delay, setDelay] = useState<0 | 3 | 10>(0); // temporizador
  const [count, setCount] = useState<number | null>(null);
  const countTimer = useRef<ReturnType<typeof setInterval>>();
  // Filtros divertidos em direto (WebGL): o canvas mostra o resultado e é dele que sai a foto.
  const fxCanvas = useRef<HTMLCanvasElement>(null);
  const fxRenderer = useRef<FunRenderer | null>(null);
  const [fx, setFx] = useState(0);
  const [fxOk, setFxOk] = useState(true);
  const [editing, setEditing] = useState(false); // a escrever a legenda (o cartão cresce e o resto afasta-se)
  const vv = useVisualViewport();
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const cycleFx = (dir: 1 | -1) => setFx((f) => (f + dir + FUN_FX.length) % FUN_FX.length);
  useEffect(() => {
    if (!ready || fx === 0 || !fxCanvas.current) return;
    fxRenderer.current ??= createFunRenderer(fxCanvas.current);
    const r = fxRenderer.current;
    if (!r) {
      setFxOk(false);
      setFx(0);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const loop = () => {
      if (video.current) r.render(video.current, fx, (performance.now() - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [ready, fx]);
  useEffect(() => () => fxRenderer.current?.dispose(), []);
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
        const s = await acquireCamera(facing, false, true);
        if (dead) return;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setCanTorch(!!caps.torch);
        // Se o aparelho não deu 3:4, tenta forçá-lo (evita a imagem cortada dentro da moldura).
        const vt = s.getVideoTracks()[0];
        const st = vt?.getSettings?.();
        if (vt && st?.width && st?.height && Math.abs(Math.min(st.width, st.height) / Math.max(st.width, st.height) - 0.75) > 0.04) {
          vt.applyConstraints({ aspectRatio: 3 / 4 }).catch(() => undefined);
        }
        setLight(false);
        setReady(true);
      } catch {
        if (!dead) setProblem(true);
      }
    })();
    return () => {
      dead = true;
    };
  }, [facing]);
  useEffect(() => () => { releaseCamera(2_000); clearTimeout(undoTimer.current); clearInterval(countTimer.current); }, []);

  /** Flash: só liga e desliga a opção; a luz acende no momento do obturador. */
  function toggleLight() {
    setLight((v) => !v);
  }
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
    // Flash ao obturar: lanterna (câmara de trás, se o aparelho deixar) ou ecrã aceso (câmara da frente).
    const vtrack = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
    let torchOn = false;
    if (light) {
      if (canTorch && vtrack) {
        try {
          await vtrack.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] });
          torchOn = true;
        } catch {
          /* sem lanterna: acende o ecrã */
        }
      }
      if (!torchOn) setLit(true);
      await new Promise((r) => setTimeout(r, 420));
    }
    const c = document.createElement('canvas');
    const fxc = fx > 0 && fxCanvas.current && fxCanvas.current.width > 0 ? fxCanvas.current : null;
    if (fxc && fxRenderer.current) fxRenderer.current.render(v, fx, performance.now() / 1000);
    const src: CanvasImageSource = fxc ?? v;
    c.width = fxc ? fxc.width : v.videoWidth;
    c.height = fxc ? fxc.height : v.videoHeight;
    const g = c.getContext('2d')!;
    // Selfie: a foto sai como a viste no ecrã (espelhada).
    if (facing === 'user') {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(src, 0, 0);
    setLit(false);
    if (torchOn && vtrack) vtrack.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
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
  /** Obturador: com temporizador faz a contagem e só depois tira; tocar outra vez cancela. */
  function press() {
    if (count !== null) {
      clearInterval(countTimer.current);
      return setCount(null);
    }
    if (!delay) return void shoot();
    let n = delay;
    setCount(n);
    countTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countTimer.current);
        setCount(null);
        void shoot();
      } else setCount(n);
    }, 1000);
  }
  async function undo() {
    if (!sent) return;
    const id = sent;
    setSent(null);
    await api.instantDelete(id).catch(() => undefined);
    refresh();
  }

  const small = 'flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition active:scale-90';
  const recent = others.slice(0, 3);
  return createPortal(
    <div role="dialog" aria-modal="true" data-swipe-all aria-label={tr('Mandar um Zás')} className="fixed inset-0 z-[90] flex flex-col bg-[#08080b] text-white" style={{ background: 'radial-gradient(120% 60% at 50% 105%, rgba(255,92,92,.28), transparent 60%), #08080b', ...visibleStyle(vv) }}>
      <SquircleDefs />
      {/* Em cima, sobre o preto: fechar, o nome e os teus Zás. */}
      <div className={`shrink-0 items-center justify-between px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] ${editing ? 'hidden' : 'flex'}`}>
        <button type="button" onClick={onClose} aria-label={tr('Fechar')} className={small}><Icon name="x" size={26} /></button>
        <span className="flex items-center gap-1.5 text-[22px] font-black italic tracking-tight"><Icon name="bolt" size={20} fill="currentColor" className="text-brand" /> Zás</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setGrid(true)} aria-label={tr('Os meus Zás')} className={small}><Icon name="grid" size={23} /></button>
        </div>
      </div>

      {/* A câmara: um cartão 3:4 de cantos bem redondos. A legenda fica dentro, afastada das curvas. */}
      <div className={`relative mx-auto flex min-h-0 w-full flex-1 items-center justify-center py-2 ${editing ? 'px-2 pt-[max(0.5rem,env(safe-area-inset-top))]' : 'px-8'}`}>
        <div className={`relative h-full ${editing ? 'w-full' : 'max-h-[440px]'}`} style={editing ? { filter: 'drop-shadow(0 18px 36px rgba(255,92,92,0.3))' } : { aspectRatio: '3 / 4', maxWidth: '100%', filter: 'drop-shadow(0 18px 36px rgba(255,92,92,0.3))' }}>
        <div
          className="absolute inset-0 overflow-hidden bg-zinc-900"
          style={SQUIRCLE}
          onTouchStart={(e) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
          onTouchEnd={(e) => {
            const st = swipe.current;
            swipe.current = null;
            if (!st || editing || !fxOk || !ready) return;
            const dx = e.changedTouches[0].clientX - st.x;
            const dy = e.changedTouches[0].clientY - st.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              navigator.vibrate?.(6);
              cycleFx(dx < 0 ? 1 : -1);
            }
          }}
        >
          <video ref={video} playsInline muted className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${ready ? '' : 'invisible'}`} />
          <canvas ref={fxCanvas} aria-hidden className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${fx > 0 ? '' : 'hidden'}`} />
          {editing && <div className="pointer-events-none absolute inset-0 bg-black/40" />}
          {ready && fxOk && !editing && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1" aria-hidden>
              {FUN_FX.map((f) => <span key={f.id} className={`h-1.5 rounded-full transition-all ${fx === f.id ? 'w-4 bg-white' : 'w-1.5 bg-white/40'}`} />)}
            </div>
          )}
          {lit && <div className="pointer-events-none absolute inset-0 z-10 bg-white" />}
          {count !== null && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-[120px] font-black drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)]" aria-live="assertive">{count}</div>}
          {!ready && <p className="absolute inset-0 flex items-center justify-center px-12 text-center text-white/80">{problem ? tr('Não consegui abrir a câmara. Os Zás só se mandam na hora.') : tr('A acordar a câmara…')}</p>}
          {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/45 to-transparent" />
          <CurvedCaption text={caption || tr('Adicionar legenda…')} hint={!caption} caret={editing} caretFirst={!caption} />
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            maxLength={80}
            enterKeyHint="done"
            autoComplete="off"
            aria-label={tr('Legenda')}
            className={`absolute left-0 z-[5] w-full bg-transparent text-[16px] opacity-0 outline-none ${editing ? 'inset-0 h-full' : 'top-0 h-2/5'}`}
            style={{ caretColor: 'transparent' }}
          />
          {err && <p role="alert" className="absolute inset-x-8 top-6 rounded-[22px] bg-red-600/90 px-4 py-2 text-center text-sm font-semibold">{err}</p>}
        </div>
        </div>
      </div>

      {/* Em baixo: quem te mandou, o obturador e virar a câmara; depois, para quem vai. */}
      <div className={`relative shrink-0 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 ${editing ? 'hidden' : ''}`}>
        {sent && (
          <div role="status" className="absolute inset-x-6 top-0 mx-auto max-w-sm -translate-y-[calc(100%+4px)] overflow-hidden rounded-[28px] bg-white text-zinc-900 shadow-lg">
            <div className="flex items-center justify-between py-2 pl-5 pr-2">
              <span className="text-[15px] font-bold">{tr('Zás enviado!')}</span>
              <button type="button" onClick={undo} className="h-9 rounded-full bg-zinc-100 px-4 text-sm font-bold active:scale-95">{tr('Desfazer')}</button>
            </div>
            <span key={sent} aria-hidden className="block h-1 rounded-full bg-brand" style={{ animation: 'shrink 6s linear forwards' }} />
          </div>
        )}
        <div className="mx-auto grid max-w-[250px] grid-cols-3 place-items-center">
          <button type="button" onClick={toggleLight} aria-pressed={light} aria-label={canTorch ? tr('Lanterna') : tr('Flash de ecrã')} className={`flex h-14 w-14 items-center justify-center rounded-full backdrop-blur transition active:scale-90 ${light ? 'bg-amber-300 text-zinc-900' : 'bg-white/10 text-white'}`}><FlashIcon on={light} size={25} /></button>
          <button type="button" onClick={press} disabled={!ready || busy} aria-label={count !== null ? tr('Cancelar') : tr('Tirar e enviar')} className="relative flex h-[86px] w-[86px] items-center justify-center rounded-full transition active:scale-90 disabled:opacity-50">
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

/**
 * Legenda dos Zás: o texto corre pela curva do cartão (em maiúsculas, com letras espaçadas), como nos Instants do Instagram.
 * `arc` escolhe o troço: 'top' sobe pela esquerda e segue pelo topo; 'bottom' desce pela esquerda e segue pelo fundo.
 */
function CurvedCaption({ text, hint = false, caret = false, caretFirst = false, arc = 'top' }: { text: string; hint?: boolean; caret?: boolean; caretFirst?: boolean; arc?: 'top' | 'bottom' }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pid = useId().replace(/[^a-zA-Z0-9]/g, '');
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { d, len } = useMemo(() => {
    const { w, h } = size;
    if (!w || !h) return { d: '', len: 0 };
    const inset = Math.min(w, h) * 0.1;
    const n = 3.4;
    const a = arc === 'top' ? Math.PI + 0.22 : Math.PI - 0.5;
    const b = arc === 'top' ? 2 * Math.PI - 0.3 : 0.45;
    const N = 80;
    let len = 0;
    let prev: [number, number] | null = null;
    const pts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const t = a + ((b - a) * i) / N;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const x = w / 2 + (w / 2 - inset) * Math.sign(c) * Math.abs(c) ** (2 / n);
      const y = h / 2 + (h / 2 - inset) * Math.sign(sn) * Math.abs(sn) ** (2 / n);
      if (prev) len += Math.hypot(x - prev[0], y - prev[1]);
      prev = [x, y];
      pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return { d: pts.join(' '), len };
  }, [size, arc]);
  const label = text.toUpperCase();
  const chars = Math.max(1, label.length + (caret ? 1 : 0));
  const fs = Math.max(8, Math.min(Math.min(size.w, size.h) * 0.052, (len - 14) / (chars * 0.8)));
  const Caret = () => <tspan fill="#3b82f6" className="animate-pulse">|</tspan>;
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-[4]" aria-hidden>
      {d && (
        <svg width={size.w} height={size.h} className="absolute inset-0 overflow-visible">
          <defs><path id={pid} d={d} /></defs>
          <text fontSize={fs} fontWeight={700} letterSpacing={fs * 0.16} fill="white" fillOpacity={hint ? 0.72 : 1} stroke="rgba(0,0,0,0.35)" strokeWidth={2.4} style={{ paintOrder: 'stroke' }}>
            <textPath href={`#${pid}`}>{caretFirst && caret && <Caret />}{label}{!caretFirst && caret && <Caret />}</textPath>
          </text>
        </svg>
      )}
    </div>
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
  const [who, setWho] = useState<{ username: string; displayName: string; hasAvatar: boolean; at: string; reaction?: string | null }[] | null>(null);
  const showWho = (id: string) => api.instantViewers(id).then(setWho).catch((e) => setErr((e as Error).message));
  const [del, setDel] = useState<InstantItem | null>(null);
  const [menu, setMenu] = useState<InstantItem | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const held = useRef(false);

  // Guardar na galeria / partilhar: no telemóvel abre a folha de partilha (com "Guardar imagem"); no computador descarrega o ficheiro.
  async function photoOf(it: InstantItem) {
    return new File([await renderZasImage(it.url, it.caption)], `zas-${it.id.slice(0, 8)}.png`, { type: 'image/png' });
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
        <button type="button" onClick={onClose} aria-label={tr('Voltar')} className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full active:scale-90"><Icon name="chevron-left" size={26} /></button>
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
                    <span role="button" tabIndex={0} aria-label={tr('Quem viu')} onClick={(e) => { e.stopPropagation(); void showWho(it.id); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void showWho(it.id); } }} className="absolute right-[10%] top-[6%] flex min-h-8 items-center gap-0.5 rounded-full px-1.5 text-[13px] font-bold drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] active:scale-90">
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
      {who && (
        <Sheet title={tr('Quem viu')} onClose={() => setWho(null)} layer="z-[100]">
          {who.length === 0 ? (
            <p className="py-6 text-center text-zinc-600">{tr('Ainda ninguém viu.')}</p>
          ) : (
            <ul>
              {who.map((v) => (
                <li key={v.username} className="flex items-center gap-3 py-2">
                  <Avatar name={v.displayName} username={v.hasAvatar ? v.username : undefined} size={40} ring={false} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{v.displayName}</span><span className="block text-sm text-zinc-500">@{v.username} · {hm(v.at)}</span></span>
                  {v.reaction && <Reaction body={v.reaction} size={30} />}
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
      {open && <InstantViewer who={{ username, displayName: '' }} own startId={open} onClose={() => { setOpen(null); void load(); }} />}
    </div>,
    document.body,
  );
}

/** Ver os Zás de alguém: foto a ecrã cheio com cantos bem redondos, cada um abre-se uma só vez. Toca à direita para o seguinte e à esquerda para o anterior. */
function InstantViewer({ who, own, onClose, onFinish, onCamera, onGrid, startId }: { who: { username: string; displayName: string }; own: boolean; onClose: () => void; onFinish?: () => void; onCamera?: () => void; onGrid?: () => void; startId?: string }) {
  const [items, setItems] = useState<InstantItem[] | null>(null);
  const [i, setI] = useState(0);
  const [viewers, setViewers] = useState<{ username: string; displayName: string; hasAvatar: boolean; at: string; reaction?: string | null }[] | null>(null);
  const [err, setErr] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const marked = useRef(new Set<string>());
  // Arrastar para baixo fecha (o cartão acompanha o dedo); duplo toque na foto reage com um brinde.
  const [drag, setDrag] = useState(0);
  const touch = useRef<{ x: number; y: number; on: boolean; up?: boolean } | null>(null);
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
      if (!t.on && !t.up) {
        if (dy > 12 && dy > Math.abs(dx) * 1.5) t.on = true;
        else if (own && dy < -12 && -dy > Math.abs(dx) * 1.5) t.up = true;
      }
      if (t.on) setDrag(Math.max(0, dy));
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const t = touch.current;
      touch.current = null;
      if (t?.on && drag > 110) onClose();
      // Deslizar para a direita volta atrás (ao chat).
      if (t && !t.on && !t.up) {
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (dx > 90 && dx > Math.abs(dy) * 1.5) {
          navigator.vibrate?.(8);
          onClose();
        }
      }
      // Nos meus Zás, deslizar para cima mostra quem viu e as reações.
      if (t?.up && e.changedTouches[0].clientY - t.y < -60) {
        navigator.vibrate?.(8);
        void showViewers();
      }
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
    <div role="dialog" aria-modal="true" data-swipe="own" aria-label={`Zás de ${who.displayName}`} {...dragProps} className="fixed inset-0 z-[96] flex flex-col bg-black text-white" style={{ backgroundColor: drag ? `rgba(0,0,0,${Math.max(0.3, 1 - drag / 400)})` : undefined }}>
      <SquircleDefs />
      <div className="flex shrink-0 items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label={tr('Fechar')} className="flex h-11 w-11 items-center justify-center rounded-full active:scale-90"><Icon name="x" size={28} /></button>
        <div className="flex items-center gap-1">
          {onGrid && <button type="button" onClick={onGrid} aria-label={tr('Os meus Zás')} className="flex h-11 w-11 items-center justify-center rounded-full active:scale-90"><Icon name="grid" size={25} /></button>}
          {onCamera && <button type="button" onClick={onCamera} aria-label={tr('Mandar o meu Zás')} className="flex h-11 w-11 items-center justify-center rounded-full active:scale-90"><Icon name="camera" size={26} /></button>}
        </div>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 items-center justify-center px-9">
      <div className="relative h-full max-h-[470px] overflow-hidden bg-zinc-900" style={{ ...SQUIRCLE, transform: drag ? `translateY(${drag}px) scale(${Math.max(0.85, 1 - drag / 1500)})` : undefined, transition: drag ? 'none' : 'transform .2s ease-out', touchAction: 'pan-x', aspectRatio: '3 / 4', maxWidth: '100%' }}>
        {cur ? <img src={cur.url} alt={cur.caption || tr('Zás')} draggable={false} onContextMenu={(e) => e.preventDefault()} className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover [-webkit-touch-callout:none]" /> : <p className="absolute inset-0 flex items-center justify-center text-white/70">{err || tr('A carregar…')}</p>}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/35 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent" />

        {/* Metades do ecrã: anterior / seguinte. */}
        <button type="button" aria-label={tr('Anterior')} onClick={() => tapZone(() => setI((k) => Math.max(0, k - 1)))} className="absolute inset-y-16 left-0 w-1/3" />
        <button type="button" aria-label={tr('Seguinte')} onClick={() => tapZone(next)} className="absolute inset-y-16 right-0 w-2/3" />
        {pop && <span key={pop.n} aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center opacity-0 animate-[burst_.9s_ease-out_forwards]"><Reaction body={pop.id} size={120} /></span>}

        {cur?.caption && <CurvedCaption text={cur.caption} arc="top" />}
        {own && cur && <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[3] flex flex-col items-center text-white/85 drop-shadow" aria-hidden><Icon name="chevron-right" size={20} className="-rotate-90" /><span className="text-[11px] font-bold uppercase tracking-wider">{tr('{n} viram', { n: cur.views ?? 0 })}</span></div>}
        {(err || note) && cur && <p role={err ? 'alert' : 'status'} className={`absolute inset-x-8 top-6 z-10 rounded-full px-4 py-2 text-center text-sm font-semibold ${err ? 'bg-red-600/90' : 'bg-emerald-600/90'}`}>{err || note}</p>}
      </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 px-4 pb-1 pt-3 text-[14px]">
        <Avatar name={who.displayName} username={who.username} size={30} ring={false} />
        <span className="max-w-[40%] truncate font-semibold">{own ? tr('Os teus Zás') : who.username}</span>
        {cur && <span className={own && new Date(cur.expiresAt).getTime() - Date.now() < 3 * 3_600_000 ? 'font-bold text-amber-300' : 'text-white/65'}>{own ? `${hm(cur.at)} · ${leftLabel(cur.expiresAt)}` : timeAgo(cur.at).replace('Há ', '')}</span>}
        {items && items.length > 1 && <span className="text-white/50">· {i + 1}/{items.length}</span>}
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
            {cur && <button type="button" onClick={() => void saveInstant(cur)} aria-label={tr('Guardar na galeria')} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 active:scale-95"><Icon name="download" size={20} /></button>}
            <button type="button" onClick={remove} aria-label={tr('Apagar Zás')} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-red-300 active:scale-95"><Icon name="trash" size={20} /></button>
          </div>
        ) : (
          <>
            <div className="mx-auto mb-3 flex max-w-[320px] flex-col items-center gap-2" role="group" aria-label={tr('Reagir')}>
              {[REACTIONS.slice(0, 4), REACTIONS.slice(4)].map((row, k) => (
                <div key={k} className="flex justify-center gap-3">
                  {row.map((r) => (
                    <button key={r.id} type="button" aria-label={r.label} onClick={() => react(r.id, r.art)} className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/10 transition active:scale-90"><Reaction body={r.id} size={34} /></button>
                  ))}
                </div>
              ))}
            </div>
            <form onSubmit={sendReply} className="flex items-center gap-2 rounded-full bg-white/12 p-1.5 pl-5">
              <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={500} placeholder={tr('Responder a {v0}…', { v0: who.displayName.split(' ')[0] })} aria-label={tr('Responder')} className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-white/60" />
              <button type="submit" disabled={!reply.trim()} aria-label={tr('Enviar')} className="flex h-11 w-11 items-center justify-center rounded-full bg-brand disabled:opacity-40 active:scale-90"><Icon name="send" size={18} /></button>
            </form>
          </>
        )}
      </div>

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
                  {v.reaction && <Reaction body={v.reaction} size={30} />}
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
