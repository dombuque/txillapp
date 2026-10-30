import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Atualizações da app, sem a pessoa fazer nada (nem desinstalar). A versão nova descarrega em segundo plano e aplica-se
 * sozinha num momento seguro: ao abrir a app, ao ir para segundo plano, ou quando a pessoa não está a escrever nem a gravar.
 * Verifica de 10 em 10 minutos, ao voltar à app e quando a rede volta.
 */
export default function UpdateBanner() {
  useEffect(() => {
    let reg: ServiceWorkerRegistration | undefined;
    let waiting = false;
    let apply: ((reload?: boolean) => Promise<void>) | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    /** A pessoa está a meio de uma ação que uma recarga estragaria? */
    const busy = () => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const delicate = /^\/(new|reels|messages\/)/.test(location.pathname);
      return typing || delicate || !!document.querySelector('[role="dialog"], [aria-modal="true"]');
    };
    const go = () => {
      waiting = false;
      if (timer) clearInterval(timer);
      void apply?.(true);
    };
    const tryApply = () => {
      if (!waiting) return;
      if (document.visibilityState === 'hidden' || !busy()) go();
    };
    const onHidden = () => document.visibilityState === 'hidden' && tryApply();

    apply = registerSW({
      immediate: true,
      onNeedRefresh: () => {
        waiting = true;
        tryApply();
        if (waiting) timer = setInterval(tryApply, 4000);
      },
      onRegisteredSW: (_url, r) => {
        reg = r;
      },
    });

    const check = () => void reg?.update().catch(() => undefined);
    const poll = setInterval(check, 10 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('online', check);
    return () => {
      clearInterval(poll);
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('online', check);
    };
  }, []);

  return null;
}
