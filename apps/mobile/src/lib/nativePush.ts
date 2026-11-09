import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { post, raw } from './api';
import { handleCallResponse, isForegroundCall, setupCallNotifications } from './callRing';
import { kvGet, kvSet } from './kv';

/**
 * Notificações na app nativa (Android/iPhone). O servidor envia pelo FCM para o código deste telemóvel, no canal "txillapp".
 * Aqui: criar o canal, pedir licença (no passo a passo das permissões), registar o código no servidor e abrir o que a
 * notificação traz ao tocar nela. Na web as notificações são as do browser (lib/push).
 */
const TOKEN_KEY = 'tx_native_push_token';

if (Platform.OS !== 'web') {
  // Com a app aberta também aparece (como as conversas no WhatsApp). As chamadas não: o ecrã de chamada da app já toca.
  Notifications.setNotificationHandler({
    handleNotification: async (n) => isForegroundCall(n)
      ? { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }
      : { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true },
  });
}

async function channel() {
  // Canal e botões das chamadas (Android e iPhone).
  await setupCallNotifications();
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('txillapp', {
    name: 'Txillapp',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: '#d6334f',
  });
}

export async function notificationsGranted(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try { return (await Notifications.getPermissionsAsync()).granted; } catch { return false; }
}

/** Pede licença para notificações (mostra o pedido do sistema). */
export async function askNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await channel();
  const r = await Notifications.requestPermissionsAsync();
  if (r.granted) await registerNativePush();
  return r.granted;
}

/** Com licença dada: regista o código deste telemóvel no servidor (sempre que a app abre: o código pode mudar). */
export async function registerNativePush(): Promise<void> {
  if (Platform.OS === 'web' || !(await notificationsGranted())) return;
  try {
    await channel();
    const t = await Notifications.getDevicePushTokenAsync();
    const token = typeof t.data === 'string' ? t.data : '';
    if (token.length < 20) return;
    await raw('/push/device', post({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' }));
    await kvSet(TOKEN_KEY, token);
  } catch {
    /* sem rede ou sem serviços da Google: tenta na próxima vez */
  }
}

/** Ao sair da conta: este telemóvel deixa de receber as notificações dela. */
export async function unregisterNativePush(): Promise<void> {
  if (Platform.OS === 'web') return;
  const token = await kvGet(TOKEN_KEY);
  if (!token) return;
  try { await raw('/push/device', { method: 'DELETE', body: JSON.stringify({ token }) }); } catch { /* */ }
  await kvSet(TOKEN_KEY, '');
}

/**
 * Tocar numa notificação abre o que ela traz (conversa, publicação, perfil…). As chamadas abrem o ecrã da chamada
 * (ou recusam, no botão Recusar) e a chamada perdida abre /calls. Devolve a função para desligar.
 */
export function onNotificationOpen(go: (url: string) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const open = (r: Notifications.NotificationResponse | null) => {
    if (r && handleCallResponse(r, go)) return;
    const url = r?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) go(url);
  };
  void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}
