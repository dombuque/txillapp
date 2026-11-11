import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { askNotifications, hasNativeToken, registerNativePush } from './nativePush';
import { nativeStatus, type PushStatus, type ReminderPlatform, type WebKind } from './pushReminder';

/** O estado das notificações neste aparelho, com o que é preciso para escolher os passos certos. */
export interface DeviceNotif {
  status: PushStatus;
  platform: ReminderPlatform;
  /** Só na web: que browser/aparelho é. */
  kind?: WebKind;
  /** Só na web, no iPhone: é o Safari. */
  safari?: boolean;
}

const platform = (): ReminderPlatform => (Platform.OS === 'ios' ? 'ios' : 'android');

/**
 * App nativa: a licença do sistema (`getPermissionsAsync`): granted, undetermined, denied (ainda dá para pedir)
 * ou blocked (`canAskAgain=false`). Com a licença dada mas sem código registado no servidor, regista outra vez em silêncio.
 */
export async function deviceNotifications(): Promise<DeviceNotif> {
  try {
    const p = await Notifications.getPermissionsAsync();
    const r = nativeStatus({ granted: p.granted, status: p.status, canAskAgain: p.canAskAgain, hasToken: await hasNativeToken() });
    if (r.resync) await registerNativePush();
    return { status: r.status, platform: platform() };
  } catch {
    return { status: 'unsupported', platform: platform() };
  }
}

/** Pede a licença (o pedido do sistema) e, se der, regista o push. Devolve o estado a seguir. */
export async function askDeviceNotifications(): Promise<PushStatus> {
  try { await askNotifications(); } catch { /* o sistema não deixou */ }
  return (await deviceNotifications()).status;
}

/** Bloqueadas: abre as definições do sistema desta app. */
export async function openDeviceSettings(): Promise<void> {
  try { await Linking.openSettings(); } catch { /* sem definições para abrir */ }
}
