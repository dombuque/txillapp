import { pushApi } from '@/lib/api.settings';

/**
 * Web Push (só na web; o service worker é o /sw.js, que importa o /push-sw.js). Porta de apps/web/src/lib/push.ts.
 * No nativo não há Web Push: as funções devolvem 'none'.
 */
const toKey = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((v, i) => v === b[i]);

const supported = () => typeof navigator !== 'undefined' && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** A subscrição tem de ser da chave atual do servidor; se a chave mudou, a antiga já não recebe nada e refaz-se. */
async function freshSubscription(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  const key = toKey(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey ?? null, key)) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
}

async function registerSubscription(sub: PushSubscription) {
  const j = sub.toJSON();
  await pushApi.pushSubscribe({ endpoint: sub.endpoint, keys: { p256dh: j.keys!.p256dh, auth: j.keys!.auth } });
}

/** Estado das notificações neste aparelho: 'on' ligadas, 'ask' dá para pedir, 'denied' bloqueadas, 'off-server' sem chave no servidor, 'none' sem suporte. */
export async function pushState(): Promise<'on' | 'ask' | 'denied' | 'off-server' | 'none'> {
  try {
    if (!supported()) return 'none';
    const { publicKey } = await pushApi.pushKey().catch(() => ({ publicKey: null }));
    if (!publicKey) return 'off-server';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'ask';
  } catch {
    return 'none';
  }
}

/**
 * O que a pessoa escolheu neste browser: 'on' (ligou), 'off' (desligou no interruptor das Definições) ou nada.
 * Com 'on' e a licença dada, se a subscrição desaparecer refaz-se em silêncio; com 'off' nunca, nem se lembra.
 */
const CHOICE_KEY = 'tx_push_web';
export function webPushChoice(): 'on' | 'off' | null {
  try {
    const v = globalThis.localStorage?.getItem(CHOICE_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}
function setChoice(v: 'on' | 'off') {
  try { globalThis.localStorage?.setItem(CHOICE_KEY, v); } catch { /* sem armazenamento: só vale agora */ }
}

const wait = <T,>(p: Promise<T>, ms: number, msg: string) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

const askPermission = () =>
  new Promise<NotificationPermission>((resolve) => {
    const r = Notification.requestPermission((p) => resolve(p)) as unknown as Promise<NotificationPermission> | undefined;
    if (r && typeof r.then === 'function') void r.then(resolve);
  });

/** Pede a permissão (só dentro de um toque) e liga as notificações deste aparelho à conta. 'on', 'denied' ou 'off' (fechou o pedido). */
export async function enablePush(): Promise<'on' | 'denied' | 'off'> {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) throw new Error('No iPhone, abre o Txillapp pelo ícone no ecrã principal (Partilhar › Adicionar ao ecrã principal) e tenta outra vez.');
  const perm = await askPermission();
  if (perm === 'denied') return 'denied';
  if (perm !== 'granted') return 'off';
  const { publicKey } = await wait(pushApi.pushKey(), 10_000, 'Sem ligação ao servidor. Tenta outra vez.');
  if (!publicKey) throw new Error('As notificações ainda não estão ativas neste servidor.');
  const reg = await wait(navigator.serviceWorker.ready, 8_000, 'O serviço de notificações ainda não arrancou. Fecha e abre a app e tenta outra vez.');
  const sub = await wait(freshSubscription(reg, publicKey), 15_000, 'Não consegui registar este telemóvel. Tenta outra vez daqui a pouco.');
  await wait(registerSubscription(sub), 10_000, 'Sem ligação ao servidor. Tenta outra vez.');
  setChoice('on');
  return 'on';
}

export async function disablePush(): Promise<void> {
  setChoice('off');
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await pushApi.pushUnsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
}

/**
 * Ao abrir com sessão: se já estavam ligadas neste aparelho, confirma que a subscrição é válida e desta conta. Nunca pede
 * permissão. Se a licença está dada e a pessoa tinha ligado (`webPushChoice() === 'on'`) mas a subscrição desapareceu
 * (o browser limpou-a), faz outra em silêncio. Devolve se ficou com a subscrição registada no servidor.
 */
export async function syncPush(): Promise<boolean> {
  try {
    if (!supported() || Notification.permission !== 'granted') return false;
    const reg = await wait(navigator.serviceWorker.ready, 8_000, 'sem service worker');
    const had = !!(await reg.pushManager.getSubscription());
    if (!had && webPushChoice() !== 'on') return false;
    const { publicKey } = await pushApi.pushKey().catch(() => ({ publicKey: null }));
    if (!publicKey) return false;
    await registerSubscription(await freshSubscription(reg, publicKey));
    if (webPushChoice() === null) setChoice('on');
    return true;
  } catch {
    /* sem rede ou sem suporte: tenta na próxima vez */
    return false;
  }
}

/** O servidor tem a chave do push (sem ela não há notificações na web). */
export async function pushServerReady(): Promise<boolean> {
  try { return !!(await pushApi.pushKey()).publicKey; } catch { return false; }
}

/** Há uma subscrição neste browser (não pede nada). */
export async function hasPushSubscription(): Promise<boolean> {
  try {
    if (!supported()) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export const pushSupported = supported;

/* ───────────── instalar e atualizar a app (PWA) ───────────── */
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
const deferred = () => (typeof window === 'undefined' ? null : ((window as unknown as { __txInstall?: InstallEvent | null }).__txInstall ?? null));

const ios = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const iosSafari = () => ios() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(navigator.userAgent);
export const mobileDevice = () => typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || ios());
export const isInstalled = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** O que mostrar na linha "Instalar a app": nada, já instalada, instalar com um toque ou as instruções do iPhone. */
export function installState(): 'none' | 'installed' | 'prompt' | 'ios' | 'ios-safari' {
  if (isInstalled()) return 'installed';
  if (!mobileDevice()) return 'none';
  if (deferred()) return 'prompt';
  if (iosSafari()) return 'ios';
  if (ios()) return 'ios-safari';
  return 'none';
}
export async function installApp(): Promise<void> {
  const e = deferred();
  if (!e) return;
  await e.prompt();
  await e.userChoice;
  (window as unknown as { __txInstall?: null }).__txInstall = null;
}

/** A versão desta build (posta no HTML pelo post-export-web.mjs); null fora da web. */
export const buildId = (): string | null => (typeof window === 'undefined' ? null : ((window as unknown as { __TX_BUILD?: string }).__TX_BUILD ?? null));

/** Há uma build mais recente no servidor do que esta? (pergunta ao /version.json, sem cache) */
export async function serverHasNewer(): Promise<boolean> {
  const mine = buildId();
  if (!mine) return false;
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    const j = (await r.json()) as { build?: string };
    return !!j.build && j.build !== mine;
  } catch {
    return false;
  }
}

/** Procura já uma versão nova: compara com o servidor e aplica o service worker novo (recarrega); senão diz que já tens a última. */
export async function checkForUpdate(): Promise<'updating' | 'latest' | 'error'> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) {
      if (await serverHasNewer()) { location.reload(); return 'updating'; }
      return 'latest';
    }
    const newer = await serverHasNewer();
    await reg.update();
    if (newer && !reg.installing && !reg.waiting) {
      // O servidor tem versão nova mas o service worker não a apanhou: recarrega na mesma (o HTML vem sem cache).
      await new Promise((r) => setTimeout(r, 1500));
      if (!reg.installing && !reg.waiting) { location.reload(); return 'updating'; }
    }
    for (let i = 0; i < 8 && !reg.installing && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 500));
    const next = reg.installing ?? reg.waiting;
    if (!next) return 'latest';
    await new Promise<void>((done) => {
      if (next.state === 'activated') return done();
      next.addEventListener('statechange', () => next.state === 'activated' && done());
      setTimeout(done, 8000);
    });
    location.reload();
    return 'updating';
  } catch {
    return 'error';
  }
}

/** Último recurso: apaga as cópias guardadas e a instalação do service worker e recarrega a app do zero. */
export async function hardReload() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
    const keys = await caches?.keys();
    await Promise.all((keys ?? []).map((k) => caches.delete(k)));
  } catch {
    /* segue para recarregar na mesma */
  }
  location.reload();
}
