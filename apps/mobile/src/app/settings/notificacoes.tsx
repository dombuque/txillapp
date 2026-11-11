import { DeviceNotifications, NotifyPrefs } from '@/components/settings/device';
import { SettingsPage } from '@/components/settings/SettingsPage';

/**
 * Notificações: o estado neste aparelho (com a faixa "desligadas neste aparelho" e o botão do lembrete; na web, instalar
 * a app e o interruptor do Web Push) e, por baixo, cada tipo de aviso.
 */
export default function NotificationSettings() {
  return (
    <SettingsPage title="Notificações">
      <DeviceNotifications />
      <NotifyPrefs />
    </SettingsPage>
  );
}
