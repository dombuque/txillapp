import { useEffect, useMemo, useRef, useState } from 'react';
import { suggestMusic } from '../lib/musicSuggest';
import { api, type Track } from '../lib/api';
import { tr } from '../lib/i18n';
import Icon from './Icon';
import { Sheet } from './ui';

const mmss = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : '');
export const licenseLabel = (l: string) => (l === 'own' ? tr('Original') : l === 'txillapp' ? tr('Artista no Txillapp') : l === 'cc0' ? 'CC0' : l === 'pdm' ? tr('Domínio público') : `CC ${l.toUpperCase()}`);

const CLIP_MAX_MS = 30_000;

/** Gravar um clipe de áudio (até 30 s) com o microfone: grava, ouve-se e usa-se. Fica privado e só é servido com URL assinado. */
function ClipRecorder({ onPick }: { onPick: (t: Track) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [ms, setMs] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const started = useRef(0);
  const blob = useRef<Blob | null>(null);
  const preview = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    preview.current?.pause();
  }, []);

  async function start() {
    setErr('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error(tr('Este telemóvel não deixa gravar áudio aqui'));
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      r.onstop = () => {
        clearInterval(timer.current);
        s.getTracks().forEach((t) => t.stop());
        const b = new Blob(chunks.current, { type: r.mimeType || mime || 'audio/webm' });
        blob.current = b;
        preview.current = new Audio(URL.createObjectURL(b));
        setMs(Math.min(CLIP_MAX_MS, Date.now() - started.current));
        setState('ready');
      };
      rec.current = r;
      started.current = Date.now();
      r.start();
      setMs(0);
      setState('recording');
      timer.current = setInterval(() => {
        const t = Date.now() - started.current;
        setMs(t);
        if (t >= CLIP_MAX_MS) r.stop();
      }, 200);
    } catch (e) {
      setErr((e as Error).name === 'NotAllowedError' ? tr('Sem permissão para o microfone. Ativa-o no browser.') : (e as Error).message);
    }
  }
  function stop() {
    if (rec.current?.state === 'recording') rec.current.stop();
  }
  async function use() {
    if (!blob.current) return;
    setBusy(true);
    setErr('');
    try {
      const mediaId = await api.uploadChatFile(blob.current, blob.current.type);
      onPick({
        kind: 'clip', mediaId, id: `clip:${mediaId}`, title: tr('Áudio original'), artist: '', url: preview.current?.src ?? '', landing: null, license: 'own', licenseUrl: null, durationMs: Math.max(500, ms), cover: null,
      });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  const secs = Math.floor(ms / 1000);
  return (
    <div className="rounded-2xl bg-zinc-50 p-3 ring-1 ring-zinc-100">
      <p className="text-sm font-semibold">{tr('Gravar o meu áudio')}</p>
      {state === 'idle' && (
        <button type="button" onClick={start} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand font-bold text-white active:scale-[0.98]"><Icon name="mic" size={18} /> {tr('Gravar (até 30 s)')}</button>
      )}
      {state === 'recording' && (
        <button type="button" onClick={stop} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-red-600 font-bold text-white active:scale-[0.98]"><span className="h-3 w-3 animate-pulse rounded-full bg-white" /> {tr('A gravar')} {secs}s · {tr('Parar')}</button>
      )}
      {state === 'ready' && (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => void preview.current?.play()} className="h-11 shrink-0 rounded-full bg-white px-4 font-semibold ring-1 ring-zinc-200 active:scale-95"><Icon name="play" size={16} fill="currentColor" className="inline" /> {secs}s</button>
          <button type="button" onClick={() => { setState('idle'); setMs(0); blob.current = null; }} className="h-11 shrink-0 rounded-full px-3 font-semibold text-zinc-600 active:bg-zinc-100">{tr('Repetir')}</button>
          <button type="button" disabled={busy} onClick={use} className="h-11 flex-1 rounded-full bg-brand font-bold text-white active:scale-[0.98] disabled:opacity-50">{busy ? tr('A enviar…') : tr('Usar')}</button>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}

const GENRES = ['chill', 'dance', 'afro', 'pop', 'rock', 'hip hop', 'jazz', 'piano', 'acoustic'];

/** Escolher uma faixa de música de licença aberta (Creative Commons): pesquisa, ouve-se um pedaço e usa-se. O crédito do autor segue com a faixa. */
export default function MusicPicker({ onPick, onClose, hint }: { onPick: (t: Track) => void; onClose: () => void; /** O que a pessoa escreveu (texto e local): serve para sugerir o género. */ hint?: string }) {
  const suggestion = useMemo(() => suggestMusic(hint), [hint]);
  const base: string = suggestion?.genre ?? GENRES[0];
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<Track[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // Procura meio segundo depois de parares de escrever.
  useEffect(() => {
    const typed = term.trim();
    // Sem pesquisa, já mostra uma lista (o género escolhido ou o primeiro).
    const q = typed.length >= 2 ? typed : base;
    const t = setTimeout(async () => {
      setBusy(true);
      setErr('');
      try {
        // As faixas dos artistas de Moçambique só vão em mimos e tchekas (a licença): este seletor do site é o das notas e dos posts.
        setItems((await api.searchMusic(q)).filter((x) => x.source !== 'local'));
      } catch (e) {
        setErr((e as Error).message);
        setItems([]);
      }
      setBusy(false);
    }, typed.length >= 2 ? 500 : 0);
    return () => clearTimeout(t);
  }, [term, base]);

  // Pára o som ao sair.
  useEffect(() => () => audio.current?.pause(), []);

  function toggle(t: Track) {
    if (playing === t.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(t.url);
    a.volume = 0.8;
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setPlaying(null);
      setErr(tr('Não consegui tocar'));
    };
    audio.current = a;
    setPlaying(t.id);
    void a.play().catch(() => setPlaying(null));
  }

  return (
    <Sheet title={tr('Música e sons')} onClose={onClose} layer="z-[70]">
      <label className="flex h-11 items-center gap-2 rounded-full bg-zinc-100 px-4 text-zinc-500 focus-within:bg-zinc-200/70">
        <Icon name="search" size={18} />
        <input value={term} onChange={(e) => setTerm(e.target.value)} autoFocus placeholder={tr('Procurar música ou sons')} aria-label={tr('Procurar música ou sons')} className="min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500" />
      </label>
      <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {GENRES.map((g) => (
          <button key={g} type="button" onClick={() => setTerm(g)} className={`h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold ${term.trim() === g || (!term.trim() && g === base) ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-700'}`}>{g}</button>
        ))}
      </div>
      {suggestion && !term.trim() && <p className="mt-2 text-[13px] font-semibold text-brand">{tr('Sugerido para o teu post ({v0}): {v1}', { v0: tr(suggestion.why), v1: suggestion.genre })}</p>}
      <p className="mt-3 text-xs text-zinc-500">{tr('Só músicas e sons de licença aberta (Creative Commons), com o crédito de quem os fez. Para a música do momento, ainda não há licença.')}</p>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <ul className="mt-3 max-h-[46dvh] overflow-y-auto">
        {busy && <li className="py-6 text-center text-zinc-500">{tr('A procurar…')}</li>}
        {!busy && items?.length === 0 && !err && <li className="py-6 text-center text-zinc-500">{tr('Nada com esse nome')}</li>}
        {!busy &&
          items?.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <button type="button" onClick={() => toggle(t)} aria-label={playing === t.id ? tr('Parar') : tr('Ouvir')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white active:scale-95">
                <Icon name={playing === t.id ? 'pause' : 'play'} size={18} fill="currentColor" />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{t.title}</span>
                <span className="block truncate text-sm text-zinc-500">{t.artist || tr('Autor desconhecido')}{t.durationMs ? ` · ${mmss(t.durationMs)}` : ''}</span>
              </span>
              <button type="button" onClick={() => { audio.current?.pause(); onPick(t); }} className="h-9 shrink-0 rounded-full bg-zinc-100 px-4 text-sm font-bold active:scale-95">{tr('Usar')}</button>
            </li>
          ))}
      </ul>
    </Sheet>
  );
}
