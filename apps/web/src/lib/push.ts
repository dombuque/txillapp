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
