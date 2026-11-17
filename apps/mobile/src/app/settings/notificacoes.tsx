import { DeviceNotifications, NotifyPrefs } from '@/components/settings/device';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { t } from '@/lib/i18n';

/**
 * Notificações: o estado neste aparelho (com a faixa "desligadas neste aparelho" e o botão do lembrete; na web, instalar
 * a app e o interruptor do Web Push) e, por baixo, cada tipo de aviso.
 */
export default function NotificationSettings() {
  return (
    <SettingsPage title={t('Notificações')}>
      <DeviceNotifications />
      <NotifyPrefs />
    </SettingsPage>
  );
}
