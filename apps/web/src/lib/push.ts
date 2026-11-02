import { api } from './api';

const toKey = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((v, i) => v === b[i]);

/** A subscrição tem de ser da chave atual do servidor; se a chave mudou, a antiga já não recebe nada e refaz-se. */
export async function freshSubscription(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  const key = toKey(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey ?? null, key)) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

/** Regista no servidor a subscrição deste aparelho, ligada à conta com sessão. */
export async function registerSubscription(sub: PushSubscription) {
  const j = sub.toJSON();
  await api.pushSubscribe({ endpoint: sub.endpoint, keys: { p256dh: j.keys!.p256dh, auth: j.keys!.auth } });
}

/**
 * Ao abrir a app com sessão: se as notificações já estão permitidas e ligadas neste aparelho, confirma que a subscrição
 * é válida e está ligada a esta conta (cobre chave nova, troca de conta e subscrições que o sistema apagou).
 * Nunca pede permissão sozinha.
 */
export async function syncPush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    if (!(await reg.pushManager.getSubscription())) return; // só mantém o que a pessoa já ligou
    const { publicKey } = await api.pushKey().catch(() => ({ publicKey: null }));
    if (!publicKey) return;
    await registerSubscription(await freshSubscription(reg, publicKey));
  } catch {
    /* sem rede ou sem suporte: tenta na próxima vez */
  }
}

/** Estado das notificações neste aparelho: 'on' ligadas, 'ask' dá para pedir, 'denied' bloqueadas pelo sistema, 'none' sem suporte ou sem servidor. */
export async function pushState(): Promise<'on' | 'ask' | 'denied' | 'none'> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'none';
    const { publicKey } = await api.pushKey().catch(() => ({ publicKey: null }));
    if (!publicKey) return 'none';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'ask';
  } catch {
    return 'none';
  }
}

const wait = <T,>(p: Promise<T>, ms: number, msg: string) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

/** O pedido de permissão em qualquer versão do browser (as mais antigas usam um callback em vez de uma promessa). */
const askPermission = () =>
  new Promise<NotificationPermission>((resolve) => {
    const r = Notification.requestPermission((p) => resolve(p)) as unknown as Promise<NotificationPermission> | undefined;
    if (r && typeof r.then === 'function') void r.then(resolve);
  });

/**
 * Pede a permissão (só dentro de um toque) e liga as notificações deste aparelho à conta.
 * Cada passo tem tempo limite e uma mensagem clara, para o botão nunca ficar à espera para sempre.
 * Devolve 'on' (ligadas), 'denied' (bloqueadas pelo sistema) ou 'off' (a pessoa fechou o pedido sem escolher).
 */
export async function enablePush(): Promise<'on' | 'denied' | 'off'> {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // No iPhone o sistema só mostra o pedido à app aberta pelo ícone do ecrã principal.
  if (ios && !standalone) throw new Error('No iPhone, abre o Txillapp pelo ícone no ecrã principal (Partilhar › Adicionar ao ecrã principal) e tenta outra vez.');
  // Primeira coisa a fazer no toque: pedir a permissão (o sistema só a mostra a partir de um toque).
  const perm = await askPermission();
  if (perm === 'denied') return 'denied';
  if (perm !== 'granted') return 'off';
  const { publicKey } = await wait(api.pushKey(), 10_000, 'Sem ligação ao servidor. Tenta outra vez.');
  if (!publicKey) throw new Error('As notificações ainda não estão ativas neste servidor.');
  const reg = await wait(navigator.serviceWorker.ready, 8_000, 'O serviço de notificações ainda não arrancou. Fecha e abre a app e tenta outra vez.');
  const sub = await wait(freshSubscription(reg, publicKey), 15_000, 'Não consegui registar este telemóvel. Tenta outra vez daqui a pouco.');
  await wait(registerSubscription(sub), 10_000, 'Sem ligação ao servidor. Tenta outra vez.');
  return 'on';
}
