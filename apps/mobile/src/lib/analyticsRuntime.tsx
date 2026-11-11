import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { usePathname, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { createAnalytics, installAnalytics, pathName, routeName, track, type AnalyticsPlatform, type Batch, type SendResult } from './analytics';
import { loadQueue, saveQueue } from './analyticsStore';
import { ApiError, api, authHeaders, post, raw } from './api';
import { SITE_URL } from './config';
import { kvGet, kvSet } from './kv';

/**
 * Liga as estatísticas de uso (lib/analytics.ts) à app: rede, armazenamento no aparelho, segundo plano, conta aberta,
 * a escolha "Ajudar a melhorar o Txillapp" e os erros globais. Chama-se `startAnalytics()` uma vez (app/_layout) e
 * `<AnalyticsLive />` fica no layout raiz: é o único ouvinte de navegação (screen_view) e mede o primeiro ecrã útil (perf).
 */
const T0 = Date.now();
const isWeb = Platform.OS === 'web';
const platform: AnalyticsPlatform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
const version = (() => {
  try {
    return Constants.expoConfig?.version ?? Constants.nativeApplicationVersion ?? undefined;
  } catch {
    return undefined;
  }
})();
/** O "não rastrear" do browser (como no site antigo): com ele ligado não sai nada. */
const dnt = () => {
  try {
    return isWeb && typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || (window as unknown as { doNotTrack?: string }).doNotTrack === '1');
  } catch {
    return false;
  }
};
const standalone = () => {
  try {
    return isWeb && typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  } catch {
    return false;
  }
};

/** Em desenvolvimento não se envia nada (a app de testes aponta muitas vezes para o servidor a sério), a não ser com EXPO_PUBLIC_ANALYTICS_DEV=1. */
const devOff = typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_ANALYTICS_DEV !== '1';

async function send(batch: Batch, urgent: boolean): Promise<SendResult> {
  if (devOff) return 'drop';
  try {
    if (isWeb && urgent) {
      // A página vai fechar ou ficar escondida: `keepalive` deixa o pedido acabar depois de a página sair. O sendBeacon
      // não serve aqui porque não leva o cabeçalho Authorization (e o token não pode ir no endereço).
      const res = await fetch(`${SITE_URL}/api/v1/analytics/events`, { method: 'POST', keepalive: true, credentials: 'include', headers: authHeaders(), body: JSON.stringify(batch) });
      return res.ok ? 'ok' : res.status === 400 || res.status === 413 ? 'drop' : 'retry';
    }
    await raw('/analytics/events', post(batch));
    return 'ok';
  } catch (e) {
    // 400/413: a API não quer estes dados (não adianta repetir). Sem rede, 401, 429 ou 5xx: tenta mais tarde.
    return e instanceof ApiError && (e.status === 400 || e.status === 413) ? 'drop' : 'retry';
  }
}

export const analytics = createAnalytics({ platform, version, send, save: saveQueue, load: loadQueue });

let started = false;
/** Arranque: liga o motor, recupera o que ficou por enviar, conta a abertura e apanha os erros globais. Uma vez. */
export function startAnalytics() {
  if (started) return;
  started = true;
  try {
    installAnalytics(analytics);
    if (dnt()) analytics.setConsent('off');
    void analytics.restore();
    track('app_open', isWeb ? { standalone: standalone() } : undefined);

    // Volta ao primeiro plano: abertura nova se passou mais de 30 min. Vai para segundo plano: envia já (na web tratam
    // disso o visibilitychange e o pagehide, mais abaixo).
    AppState.addEventListener('change', (s) => {
      if (s === 'active') analytics.resumed();
      else if (s === 'background' && !isWeb) analytics.backgrounded();
    });

    if (isWeb && typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && analytics.backgrounded());
      window.addEventListener('pagehide', () => analytics.backgrounded());
      window.addEventListener('error', (e) => {
        const msg = String(e.message || '');
        // Ruído do browser que não é erro da app.
        if (!msg || /^Script error\.?$/i.test(msg) || /ResizeObserver loop/i.test(msg)) return;
        analytics.error(msg, 'js');
      });
      window.addEventListener('unhandledrejection', (e) => analytics.error((e as PromiseRejectionEvent).reason ?? 'rejeição', 'promise'));
    } else {
      const eu = (globalThis as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } }).ErrorUtils;
      const prev = eu?.getGlobalHandler();
      eu?.setGlobalHandler((e, fatal) => {
        try {
          analytics.error(e, fatal ? 'fatal' : 'js');
          if (fatal) analytics.persistNow(); // a app vai fechar: fica guardado e segue na próxima abertura
        } catch {
          /* nada */
        }
        prev?.(e, fatal);
      });
    }
  } catch {
    /* as estatísticas nunca impedem a app de arrancar */
  }
}

/** Erro apanhado pelo ErrorBoundary do layout raiz (um ecrã que rebentou). */
export const reportRenderError = (e: unknown) => analytics.error(e, 'render');

/** Milissegundos desde que a app começou a arrancar (web: desde o pedido da página; nativo: desde o início do código). */
function sinceStart(): { value: number; from: string } {
  try {
    const perf = (globalThis as { performance?: { now(): number } }).performance;
    if (isWeb && perf) return { value: Math.round(perf.now()), from: 'navigation' };
    const b = (globalThis as { __BUNDLE_START_TIME__?: number }).__BUNDLE_START_TIME__;
    const nativeNow = (globalThis as { nativePerformanceNow?: () => number }).nativePerformanceNow;
    if (typeof b === 'number' && nativeNow) return { value: Math.round(nativeNow() - b), from: 'bundle' };
  } catch {
    /* plano B */
  }
  return { value: Date.now() - T0, from: 'js' };
}

const consentKey = (uid: string) => `tx_an_ok_${uid}`;
let perfSent = false;

/**
 * No layout raiz, dentro do router e do AuthProvider: diz ao motor que conta está aberta e a escolha dela, conta os
 * ecrãs (um screen_view por mudança de rota, com o nome do ficheiro e nunca o id) e mede o primeiro ecrã útil.
 */
export function AnalyticsLive({ userId, ready }: { userId: string | null; ready: boolean }) {
  const segments = useSegments() as string[];
  const pathname = usePathname();
  const route = segments.length ? routeName(segments) : pathName(pathname || '/');

  // A conta aberta. A escolha dela vem primeiro do que ficou guardado neste aparelho e depois do servidor.
  useEffect(() => {
    analytics.setUser(userId);
    if (!userId || dnt()) return;
    void kvGet(consentKey(userId)).then((v) => {
      if ((v === '1' || v === '0') && analytics.state().consent === 'unknown' && analytics.state().user === userId) analytics.setConsent(v === '1' ? 'on' : 'off');
    });
  }, [userId]);

  // As Definições de privacidade (a mesma consulta que o resto da app usa, por isso não há pedido a mais). Ao mudar o
  // interruptor "Ajudar a melhorar o Txillapp", o ecrã das Definições atualiza esta consulta e a escolha vale logo.
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: api.privacy, enabled: !!userId, staleTime: 5 * 60_000 });
  const share = privacy.data?.shareAnalytics;
  useEffect(() => {
    if (!userId || typeof share !== 'boolean' || dnt()) return;
    analytics.setConsent(share ? 'on' : 'off');
    void kvSet(consentKey(userId), share ? '1' : '0');
  }, [userId, share]);

  useEffect(() => {
    analytics.screenView(route);
  }, [route]);

  // Tempo até ao primeiro ecrã útil (depois de saber se há sessão), uma vez por arranque.
  useEffect(() => {
    if (!ready || perfSent) return;
    perfSent = true;
    const done = () => {
      const t = sinceStart();
      if (t.value > 0 && t.value < 120_000) track('perf', { metric: `first_screen_${platform}`, value: t.value, from: t.from, logged: !!userId });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => done());
    else done();
  }, [ready, userId]);

  return null;
}
