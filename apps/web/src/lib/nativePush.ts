import { api } from './api';
import { isNative } from './native';

const KEY = 'txill.push-token';
let listening = false;

/**
 * Notificações da app Android (Firebase). Ao entrar com sessão pede a permissão do sistema (a primeira vez) e regista o aparelho.
 * Sem Firebase configurado na app, falha em silêncio e a app continua normal.
 */
export async function syncNativePush(): Promise<void> {
  if (!isNative()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    if (!listening) {
      listening = true;
      await PushNotifications.addListener('registration', (t) => {
        try { localStorage.setItem(KEY, t.value); } catch { /* sem armazenamento */ }
        void api.pushDevice(t.value, 'android').catch(() => undefined);
      });
      await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
        const url = (a.notification.data as { url?: string } | undefined)?.url;
        if (url?.startsWith('/')) {
          window.history.pushState({}, '', url);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      });
    }
    await PushNotifications.createChannel({ id: 'txillapp', name: 'Txillapp', description: 'Mensagens, brindes, seguidores e comentários', importance: 4, visibility: 0 }).catch(() => undefined);
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
    if (perm.receive === 'granted') await PushNotifications.register();
  } catch {
    /* sem Firebase ou sem permissão: tenta na próxima vez */
  }
}

/** Ao sair da conta: este aparelho deixa de receber as notificações dela. */
export async function forgetNativePush(): Promise<void> {
  if (!isNative()) return;
  try {
    const token = localStorage.getItem(KEY);
    if (token) await api.pushDeviceRemove(token).catch(() => undefined);
    localStorage.removeItem(KEY);
  } catch { /* nada a esquecer */ }
}
