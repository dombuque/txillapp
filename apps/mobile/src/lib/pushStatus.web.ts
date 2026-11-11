import { enablePush, hasPushSubscription, isInstalled, pushServerReady, pushSupported, syncPush, webPushChoice } from './push';
import { isIosSafari, webKind, webStatus, type PushStatus, type ReminderPlatform, type WebKind } from './pushReminder';

export interface DeviceNotif {
  status: PushStatus;
  platform: ReminderPlatform;
  kind?: WebKind;
  safari?: boolean;
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
const touchMac = () => typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

/**
 * Site e PWA: `Notification.permission`, o suporte a service worker/PushManager e, no iPhone, se a app está no ecrã
 * principal (sem isso o push não existe: "precisa de instalar"). Com a licença dada e a pessoa a ter ligado, mas sem
 * subscrição, refaz-a em silêncio. Sem a chave do push no servidor conta como "sem suporte" (não há nada a ligar).
 */
export async function deviceNotifications(): Promise<DeviceNotif> {
  const standalone = isInstalled();
  const kind = webKind(ua(), { standalone, touchMac: touchMac() });
  const base = { platform: 'web' as const, kind, safari: isIosSafari(ua()) };
  try {
    const supported = pushSupported();
    const permission = supported ? Notification.permission : 'default';
    const subscribed = supported && permission === 'granted' ? await hasPushSubscription() : false;
    const r = webStatus({ ios: kind === 'ios-pwa' || kind === 'ios-browser', standalone, supported, permission, subscribed, choice: webPushChoice() });
    if (r.resync && (await syncPush())) return { ...base, status: 'granted' };
    if (r.status === 'undetermined' && !(await pushServerReady())) return { ...base, status: 'unsupported' };
    return { ...base, status: r.status };
  } catch {
    return { ...base, status: 'unsupported' };
  }
}

/**
 * Pede a licença do browser e liga o push (tem de ser chamado logo no toque, sem esperas antes). Devolve o estado a
 * seguir; os erros (sem rede, servidor sem push…) sobem com uma mensagem para mostrar.
 */
export async function askDeviceNotifications(): Promise<PushStatus> {
  const r = await enablePush();
  return r === 'on' ? 'granted' : r === 'denied' ? 'blocked' : 'undetermined';
}

/** Na web não há "definições do sistema" para abrir: mostram-se os passos do cadeado. */
export async function openDeviceSettings(): Promise<void> {
  /* nada */
}
