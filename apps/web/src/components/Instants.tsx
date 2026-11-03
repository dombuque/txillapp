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
 * Instants: uma foto tirada na hora, com uma legenda curta, que dura 24 h e cada pessoa vê uma só vez.
 * Só chega aos amigos próximos e a quem se segue mutuamente. Aqui é a faixa que fica no feed.
 */
export default function InstantsStrip() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['instants'], queryFn: api.instants, refetchInterval: 60_000 });
  const [shooting, setShooting] = useState(false);
  const [viewing, setViewing] = useState<{ username: string; displayName: string } | null>(null);
  if (!user) return null;
  const mine = data?.mine;
  const others = data?.others ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ['instants'] });

  return (
    <section aria-label="Instants" className="mx-4 mb-4 rounded-3xl bg-gradient-to-r from-brand/10 via-orange-50 to-amber-50 p-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white"><Icon name="sparkles" size={14} /></span>
        <h2 className="text-[15px] font-extrabold tracking-tight">Instants</h2>
        <span className="text-xs text-zinc-600">{tr('foto na hora · 24 h · vista uma vez')}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-[68px] shrink-0 flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => (mine?.count ? setViewing({ username: user.username, displayName: user.displayName }) : setShooting(true))}
            aria-label={mine?.count ? tr('Ver os meus Instants') : tr('Tirar um Instant')}
            className="relative flex h-[84px] w-[68px] items-center justify-center rounded-[22px] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.1)] ring-2 ring-white active:scale-95"
          >
            <Avatar name={user.displayName} username={user.username} size={48} ring={false} />
            {!mine?.count && <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white ring-2 ring-white"><Icon name="camera" size={15} /></span>}
          </button>
          <span className="w-full truncate text-center text-xs font-semibold">{mine?.count ? tr('Os teus · {n}', { n: mine.count }) : tr('Tirar')}</span>
          {!!mine?.count && <button type="button" onClick={() => setShooting(true)} className="-mt-0.5 text-[11px] font-bold text-brand">+ {tr('Novo')}</button>}
        </div>
        {others.map((o) => (
          <div key={o.username} className="flex w-[68px] shrink-0 flex-col items-center gap-1">
            <button type="button" onClick={() => setViewing({ username: o.username, displayName: o.displayName })} aria-label={tr('Ver Instants de {v0}', { v0: o.displayName })} className="relative flex h-[84px] w-[68px] items-center justify-center rounded-[22px] bg-gradient-to-br from-brand via-[#ff7a59] to-amber-400 p-[3px] shadow-[0_2px_10px_rgba(214,51,79,0.3)] active:scale-95">
              <span className="flex h-full w-full items-center justify-center rounded-[19px] bg-white"><Avatar name={o.displayName} username={o.hasAvatar ? o.username : undefined} size={48} ring={false} /></span>
              {o.count > 1 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-[11px] font-bold text-white ring-2 ring-white">{o.count}</span>}
            </button>
            <span className="w-full truncate text-center text-xs">{o.displayName.split(' ')[0]}</span>
          </div>
        ))}
        {!others.length && !mine?.count && <p className="self-center pr-2 text-[13px] leading-snug text-zinc-600">{tr('Quando os teus amigos próximos ou quem se segue contigo tirar um Instant, aparece aqui.')}</p>}
      </div>
      {shooting && <InstantCamera onClose={() => setShooting(false)} onSent={() => { setShooting(false); refresh(); }} />}
      {viewing && <InstantViewer who={viewing} own={viewing.username === user.username} onClose={() => { setViewing(null); refresh(); }} />}
    </section>
  );
}

/** Câmara do Instant: sem galeria e sem edição. Escreve-se a legenda antes, tira-se a foto e envia-se. */
function InstantCamera({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState(false);
  const [caption, setCaption] = useState('');
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (shot) return;
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
  }, [facing, shot]);
  useEffect(() => () => releaseCamera(5_000), []);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  function take() {
    const v = video.current;
    if (!v || !ready || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    navigator.vibrate?.(15);
    c.toBlob((b) => b && setShot({ file: new File([b], `instant-${Date.now()}.jpg`, { type: 'image/jpeg' }), url: URL.createObjectURL(b) }), 'image/jpeg', 0.9);
  }
  async function send() {
    if (!shot || busy) return;
    setBusy(true);
    setErr('');
    try {
      const mediaId = await api.uploadChatFile(shot.file, 'image/jpeg');
      await api.instantCreate(mediaId, caption.trim());
      onSent();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={tr('Tirar um Instant')} className="fixed inset-0 z-[90] flex flex-col bg-zinc-950 text-white">
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label={tr('Fechar')} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 active:scale-90"><Icon name="x" size={24} /></button>
        <span className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-sm font-extrabold"><Icon name="sparkles" size={14} /> Instant</span>
        {!shot ? <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label={tr('Virar câmara')} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 active:scale-90"><Icon name="flip-camera" size={24} /></button> : <span className="w-11" />}
      </div>

      <div className="relative mx-auto mt-3 aspect-[3/4] w-[min(88vw,52dvh*0.75+12vw)] max-h-[64dvh] overflow-hidden rounded-[28px] bg-black ring-4 ring-white">
        {shot ? (
          <img src={shot.url} alt={tr('A tua foto')} className="h-full w-full object-cover" />
        ) : (
          <>
            <video ref={video} playsInline muted className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${ready ? '' : 'invisible'}`} />
            {!ready && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-white/80">{problem ? tr('Não consegui abrir a câmara. Os Instants só se tiram na hora.') : tr('A acordar a câmara…')}</p>}
          </>
        )}
        {(caption || shot) && caption && <p className="absolute inset-x-3 bottom-3 rounded-2xl bg-black/55 px-3 py-2 text-center text-[17px] font-bold leading-snug backdrop-blur-sm">{caption}</p>}
      </div>

      <div className="mx-auto mt-3 w-[min(88vw,420px)]">
        {!shot && <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={80} placeholder={tr('Uma legenda curta (antes da foto)')} aria-label={tr('Legenda')} className="h-11 w-full rounded-full bg-white/15 px-4 text-center text-[16px] outline-none placeholder:text-white/60 focus:bg-white/25" />}
        {err && <p role="alert" className="mt-2 text-center text-sm text-red-300">{err}</p>}
      </div>

      <div className="mt-auto flex items-center justify-center gap-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-4">
        {shot ? (
          <>
            <button type="button" onClick={() => setShot(null)} disabled={busy} className="h-12 rounded-full bg-white/15 px-6 font-semibold active:scale-95 disabled:opacity-50">{tr('Repetir')}</button>
            <button type="button" onClick={send} disabled={busy} className="h-12 rounded-full bg-brand px-8 font-bold active:scale-95 disabled:opacity-50">{busy ? tr('A enviar…') : tr('Enviar Instant')}</button>
          </>
        ) : (
          <button type="button" onClick={take} disabled={!ready} aria-label={tr('Tirar foto')} className="flex h-[84px] w-[84px] items-center justify-center rounded-full border-[5px] border-white transition active:scale-90 disabled:opacity-40">
            <span className="h-[62px] w-[62px] rounded-full bg-white" />
          </button>
        )}
      </div>
    </div>,
    document.body,
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
    <div role="dialog" aria-modal="true" aria-label={`Instants de ${who.displayName}`} className="fixed inset-0 z-[90] flex flex-col bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-white">
      <div className="flex gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]" aria-hidden>
        {(items ?? [{ id: 'x' }]).map((x, k) => <span key={x.id} className={`h-1 flex-1 rounded-full ${k <= i ? 'bg-white' : 'bg-white/30'}`} />)}
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar name={who.displayName} username={who.username} size={36} ring={false} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold leading-tight">{own ? tr('Os teus Instants') : who.displayName}</span>
          {cur && <span className="block text-xs text-white/70">{hm(cur.at)} · {leftLabel(cur.expiresAt)}</span>}
        </span>
        <button type="button" onClick={onClose} aria-label={tr('Fechar')} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 active:scale-90"><Icon name="x" size={22} /></button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-5 pb-2">
        {cur ? (
          <figure className="relative w-full max-w-sm rotate-[-1.2deg] rounded-[26px] bg-white p-3 pb-4 shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
            <img src={cur.url} alt={cur.caption || tr('Instant')} draggable={false} className="aspect-[3/4] max-h-[62dvh] w-full rounded-[18px] object-cover" />
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
          <p className="flex items-center gap-2 text-[13px] text-white/70"><Icon name="once" size={16} /> {tr('Só se vê uma vez. Ao fechar, desaparece.')}</p>
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
