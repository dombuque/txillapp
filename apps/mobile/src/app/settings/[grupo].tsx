import { Redirect, useLocalSearchParams } from 'expo-router';
import { DevicesList } from '@/components/settings/sheets';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { settingsTargetFor } from '@/lib/settingsIndex';

/**
 * Qualquer outro /settings/<nome>. "aparelhos" mostra as sessões iniciadas enquanto não houver o ecrã próprio
 * (settings/aparelhos.tsx, que passa à frente desta rota quando existir). Nomes antigos ou em inglês
 * (/settings/notifications, /settings/privacy…) seguem para o grupo certo; o resto volta ao início.
 */
export default function SettingsFallback() {
  const { grupo } = useLocalSearchParams<{ grupo: string }>();
  if (grupo === 'aparelhos') {
    return (
      <SettingsPage title="Os teus aparelhos">
        <DevicesList />
      </SettingsPage>
    );
  }
  const target = settingsTargetFor(typeof grupo === 'string' ? grupo : '') ?? '/settings';
  return <Redirect href={target as never} />;
}
