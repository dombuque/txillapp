import { Redirect, useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';
import { SettingsHome } from '@/components/settings/SettingsHome';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { useDesktop } from '@/lib/desktop';
import { legacySettingsTarget } from '@/lib/settingsIndex';
import AccountSettings from './conta';

/**
 * /settings: o início das Definições. As ligações antigas (`/settings?s=notificacoes`, `/settings#privacidade`…)
 * seguem para o ecrã novo. No computador a lista já está à esquerda: à direita abre-se a Conta.
 */
export default function SettingsIndex() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const desktop = useDesktop();
  const hash = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hash : '';
  const target = legacySettingsTarget(params, hash);
  if (target) return <Redirect href={target as never} />;
  if (desktop) return <AccountSettings />;
  return (
    <SettingsPage title="Definições">
      <SettingsHome />
    </SettingsPage>
  );
}
