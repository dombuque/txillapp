import { track } from '../lib/analytics';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import Icon from './Icon';

type State = 'checking' | 'unsupported' | 'off-server' | 'denied' | 'off' | 'on';

const toKey = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Ligar ou desligar as notificações no telemóvel (Web Push). Funciona na app instalada, em HTTPS. */
export default function PushToggle() {
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return alive && setState('unsupported');
      const { publicKey } = await api.pushKey().catch(() => ({ publicKey: null }));
      if (!publicKey) return alive && setState('off-server');
      if (Notification.permission === 'denied') return alive && setState('denied');
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (alive) setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => alive && setState('unsupported'));
    return () => { alive = false; };
  }, []);

  async function enable() {
    setBusy(true);
    setErr('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setState(perm === 'denied' ? 'denied' : 'off');
      const { publicKey } = await api.pushKey();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey!) });
      const j = sub.toJSON();
      await api.pushSubscribe({ endpoint: sub.endpoint, keys: { p256dh: j.keys!.p256dh, auth: j.keys!.auth } });
      track('push_enabled');
      setState('on');
    } catch (x) {
      setErr((x as Error).message || 'Não consegui ligar as notificações');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  }

  const text =
    state === 'unsupported' ? 'Instala a app no ecrã principal e abre-a por lá (no iPhone: iOS 16.4 ou mais recente).'
    : state === 'off-server' ? 'Ainda não estão ativas neste servidor.'
    : state === 'denied' ? 'Bloqueadas no browser: ativa-as nas definições do site.'
    : err || 'Avisa-te de mensagens, comentários e pedidos, sem mostrar o conteúdo.';
  const available = state === 'on' || state === 'off';
  const on = state === 'on';
  return (
    <div className="flex min-h-[56px] items-center gap-3.5 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="bell" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium">Notificações no telemóvel</span>
        <span className={`block text-sm ${err ? 'text-red-600' : 'text-zinc-600'}`}>{text}</span>
        {on && (
          <button
            type="button"
            onClick={async () => {
              setErr('');
              try {
                await api.pushTest();
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
            className="mt-1 text-sm font-semibold text-brand underline"
          >
            Enviar notificação de teste
          </button>
        )}
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label="Notificações no telemóvel"
        disabled={!available || busy}
        onClick={() => (on ? disable() : enable())}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-brand' : 'bg-zinc-300'}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );
}
