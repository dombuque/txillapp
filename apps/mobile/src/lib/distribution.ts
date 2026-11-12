import { Platform } from 'react-native';
import { channelFor, channelLabel, selfUpdates, type Channel } from './channel';

export { channelFor, channelLabel, selfUpdates, type Channel };

export const CHANNEL: Channel = channelFor(Platform.OS, process.env.EXPO_PUBLIC_CHANNEL);

/** Instalada a partir de uma loja (Google Play ou App Store): valem as regras da loja. */
export const isStoreBuild = CHANNEL === 'play' || CHANNEL === 'appstore';

/** Pode ter o aviso de atualização próprio (descarregar o APK do site)? Só o APK beta; nas lojas atualiza a loja. */
export const canSelfUpdate = selfUpdates(CHANNEL);
