import Icon from './Icon';
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Atualizações da app: a versão nova descarrega em segundo plano e aparece este aviso.
 * Ao tocar em "Atualizar" a app recarrega já com a versão nova. Verifica de 30 em 30 minutos e sempre que voltas à app.
 */
export default function UpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [update, setUpdate] = useState<null | ((reload?: boolean) => Promise<void>)>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let reg: ServiceWorkerRegistration | undefined;
    const fn = registerSW({
      onNeedRefresh: () => setNeedRefresh(true),
      onRegisteredSW: (_url, r) => {
        reg = r;
      },
    });
    setUpdate(() => fn);
    const check = () => void reg?.update().catch(() => undefined);
    const timer = setInterval(check, 30 * 60_000);
    const vis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[95] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-3 text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
      <Icon name="sparkles" size={22} />
      <span className="min-w-0 flex-1 text-[15px] font-semibold leading-tight">Há uma versão nova do Txillapp</span>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void update?.(true);
        }}
        className="h-10 rounded-full bg-brand px-5 text-[15px] font-bold active:scale-95 disabled:opacity-60"
      >
        {busy ? '…' : 'Atualizar'}
      </button>
      <button onClick={() => setNeedRefresh(false)} aria-label="Depois" className="-mr-1 flex h-9 w-9 items-center justify-center rounded-full text-xl text-zinc-400 active:bg-white/10">×</button>
    </div>
  );
}
