import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Platform, Share } from 'react-native';
import { EditProfileSheet } from '@/components/ProfileSheets';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { RegionRow } from '@/components/settings/device';
import { genderLabel } from '@/components/settings/options';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { DeleteSheet, GenderSheet } from '@/components/settings/sheets';
import { usePrivacy } from '@/components/settings/usePrivacy';
import { useLeave } from '@/components/settings/useLeave';
import { api, openActivate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { blueSealEntry } from '@/lib/iap/view';
import { usePurchases } from '@/lib/purchases';

/** Conta: o perfil, o email e o @, como te identificas, a verificação, os teus dados e, no fundo, eliminar a conta. */
export default function AccountSettings() {
  const { user } = useAuth();
  const leave = useLeave();
  const me = user?.username ?? '';
  const { p, save } = usePrivacy();
  const [sheet, setSheet] = useState<null | 'edit' | 'gender' | 'delete'>(null);
  const [exporting, setExporting] = useState(false);
  const close = () => setSheet(null);
  const profile = useQuery({ queryKey: ['profile', me], queryFn: () => api.profile(me), enabled: !!user });
  const email = useQuery({ queryKey: ['email-status'], queryFn: api.emailStatus, staleTime: 60_000 });
  const ver = useQuery({ queryKey: ['verification'], queryFn: api.verificationStatus, staleTime: 60_000 });
  const purchases = usePurchases();
  // A mesma regra da Verificação: a entrada do selo azul só com as compras pela loja e conforme a aprovação.
  const blue = purchases.storeVerification && ver.data ? blueSealEntry(ver.data) : null;

  async function downloadData() {
    if (exporting) return;
    setExporting(true);
    try {
      const json = await api.exportData();
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `txillapp-dados-${me}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        await Share.share({ message: json, title: `txillapp-dados-${me}.json` });
      }
    } catch (x) {
      Alert.alert('Os meus dados', (x as Error).message);
    } finally {
      setExporting(false);
    }
  }

  // A terminar sessão (ou depois de eliminar a conta) o ecrã ainda se desenha uma vez já sem conta: nada, em vez de rebentar.
  if (!user) return null;
  const e = email.data;
  const unconfirmed = !!e && e.required && !e.verified;
  return (
    <SettingsPage title="Conta">
      <SettingsSection>
        <SettingRow anchor="editProfile" icon="user" title="Editar perfil" description="Nome, foto, bio e cidade" onPress={profile.data ? () => setSheet('edit') : undefined} />
        <SettingRow
          anchor="email"
          icon="mail"
          title="Email"
          value={e?.email ?? (email.isLoading ? '…' : undefined)}
          description={unconfirmed ? 'Por confirmar: toca para ativar a conta' : e?.verified ? 'Confirmado' : undefined}
          onPress={unconfirmed ? openActivate : undefined}
          locked={!unconfirmed}
        />
        <SettingRow anchor="username" icon="at" title="Nome de utilizador" value={`@${user.username}`} locked />
      </SettingsSection>

      <SettingsSection title="Perfil">
        <SettingRow anchor="gender" icon="user-circle" title="Como me identifico" value={p ? (p.gender ? genderLabel(p.gender) : 'Por escolher') : '…'} onPress={p && !p.gender ? () => setSheet('gender') : undefined} locked={!!p?.gender} />
        {p && p.gender && p.gender !== 'unspecified' ? <SettingRow anchor="showGender" icon="user" title="Mostrar no perfil" description="Quem vê o teu perfil vê também isto." toggle={{ on: p.showGender, onChange: (v) => void save({ showGender: v }) }} /> : null}
        <SettingRow anchor="verification" icon={<VerifiedBadge size={22} tier={ver.data?.tier} />} title={ver.data?.verified ? 'A tua conta está verificada' : 'Pedir o selo de verificado'} to="/verification" />
        {blue ? <SettingRow icon={<VerifiedBadge size={22} tier="paid" />} title={blue.title} description={blue.description} to="/selo-azul" /> : null}
        {/* Programa de artistas moçambicanos: o pedido, carregar e gerir as músicas. */}
        <SettingRow anchor="artist" icon="music" title="Sou artista" description="As tuas músicas nos mimos e nas tchekas da malta" to="/artista" />
        <RegionRow />
      </SettingsSection>

      <SettingsSection title="Os teus dados" note="Um ficheiro com o teu perfil, publicações, conversas e o resto do que é teu.">
        <SettingRow anchor="exportData" icon="download" title={exporting ? 'A preparar…' : 'Descarregar os meus dados'} onPress={() => void downloadData()} />
      </SettingsSection>

      <SettingsSection title="Zona perigosa">
        <SettingRow anchor="deleteAccount" icon="trash" title="Eliminar conta" description="Apaga a conta e tudo o que é teu. Não se desfaz." danger onPress={() => setSheet('delete')} />
      </SettingsSection>

      {sheet === 'edit' && profile.data && <EditProfileSheet profile={profile.data} onClose={close} />}
      {sheet === 'gender' && p && <GenderSheet value={p.gender} onPick={(g) => void save({ gender: g })} onClose={close} />}
      {sheet === 'delete' && <DeleteSheet username={user.username} onClose={close} onDeleted={() => void leave().catch(() => undefined)} />}
    </SettingsPage>
  );
}
