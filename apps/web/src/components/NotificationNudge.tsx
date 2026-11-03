import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { useLocation } from 'react-router-dom';
import { track } from '../lib/analytics';
import { enablePush, pushState } from '../lib/push';
import Icon from './Icon';

const KEY = 'txill.push-nudge';
const DAY = 24 * 60 * 60 * 1000;
/** De quanto em quanto tempo volta a lembrar: pode pedir-se (3 dias) ou estão bloqueadas pelo sistema (14 dias). */
const EVERY = { ask: 3 * DAY, denied: 14 * DAY };

const read = (): number => {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
};
const mark = () => {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* sem armazenamento: não faz mal */
  }
};

/**
 * Lembrete discreto, de tempos em tempos, para ligar as notificações neste aparelho (sem elas, não chega nada de mensagens,
 * respostas ou seguidores). Nunca bloqueia a app: "Agora não" adia. Só aparece se estiverem desligadas e o aparelho as suportar.
 */
export default function NotificationNudge({ ready }: { ready: boolean }) {
  const { pathname } = useLocation();
  const [mode, setMode] = useState<null | 'ask' | 'denied'>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Depois de a pessoa já ter começado a usar a app (e de a visita guiada acabar), e só se já passou o tempo desde o último lembrete.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const t = setTimeout(async () => {
      const st = await pushState();
      if (!alive || st === 'on' || st === 'none') return;
      if (Date.now() - read() < EVERY[st]) return;
      setMode(st);
    }, 25_000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [ready]);

  if (!mode || pathname.startsWith('/new') || pathname.startsWith('/messages/') || pathname === '/reels') return null;

  const later = () => {
    mark();
    setMode(null);
  };
  async function turnOn() {
    setBusy(true);
    setErr('');
    try {
      const r = await enablePush();
      if (r === 'on') {
        track('push_enabled', { from: 'nudge' });
        return setMode(null);
      }
      if (r === 'denied') return setMode('denied');
      setErr('O telemóvel não chegou a mostrar o pedido. Toca outra vez em Ligar notificações.');
    } catch (x) {
      setErr((x as Error).message || 'Não consegui ligar as notificações');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label={tr('Ligar notificações')} className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[70] mx-auto max-w-md animate-[rise_.25s_ease-out] rounded-[20px] bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.22)] ring-1 ring-zinc-100">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-brand"><Icon name="bell" size={22} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-extrabold leading-tight">{mode === 'ask' ? 'Não percas nada, malta' : 'As notificações estão bloqueadas'}</p>
          <p className="mt-1 text-[14px] leading-snug text-zinc-600">
            {mode === 'ask'
              ? 'Liga as notificações para saberes logo quando alguém te escreve, responde ou te segue.'
              : 'Neste aparelho estão desligadas para o Txillapp. Ativa em Definições do telemóvel › Notificações › Txillapp.'}
          </p>
        </div>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={later} className="h-10 rounded-full px-4 text-sm font-semibold text-zinc-600 active:bg-zinc-100">{mode === 'ask' ? 'Agora não' : 'Entendi'}</button>
        {mode === 'ask' && (
          <button onClick={turnOn} disabled={busy} className="h-10 rounded-full bg-brand px-5 text-sm font-bold text-white active:scale-95 disabled:opacity-60">{busy ? 'A ligar…' : 'Ligar notificações'}</button>
        )}
      </div>
    </div>
  );
}
