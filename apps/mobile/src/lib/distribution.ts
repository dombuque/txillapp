import { Platform } from 'react-native';
import { channelFor, type Channel } from './channel';

export { channelFor, type Channel };

export const CHANNEL: Channel = channelFor(Platform.OS, process.env.EXPO_PUBLIC_CHANNEL);

/** Instalada a partir de uma loja (Google Play ou App Store): valem as regras da loja. */
export const isStoreBuild = CHANNEL === 'play' || CHANNEL === 'appstore';
