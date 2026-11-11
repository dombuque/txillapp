import { Redirect, useLocalSearchParams } from 'expo-router';
import { settingsTargetFor } from '@/lib/settingsIndex';

/**
 * Qualquer outro /settings/<nome> (os grupos e /settings/aparelhos têm ecrã próprio, que passa à frente desta rota).
 * Nomes antigos ou em inglês (/settings/notifications, /settings/privacy…) seguem para o grupo certo; o resto volta ao início.
 */
export default function SettingsFallback() {
  const { grupo } = useLocalSearchParams<{ grupo: string }>();
  const target = settingsTargetFor(typeof grupo === 'string' ? grupo : '') ?? '/settings';
  return <Redirect href={target as never} />;
}
