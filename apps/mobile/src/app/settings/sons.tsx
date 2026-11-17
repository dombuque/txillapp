import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PageLoader } from '@/components/PontoLoader';
import { SettingsSection } from '@/components/settings/SettingRow';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { ApiError } from '@/lib/api';
import { soundsApi, type MySound } from '@/lib/api.sounds';
import { sized } from '@/lib/config';
import { mySoundStatus, RETIRE_SOUND_TEXT, RETIRE_SOUND_TITLE, soundHref, usesLine } from '@/lib/sounds';
import { confirm } from '@/lib/confirm';
import { colors } from '@/lib/theme';
import { showToast } from '@/lib/toast';

/**
 * Definições › Conteúdo › «Os meus sons»: os sons originais das minhas tchekas (docs/sons.md), quantas tchekas os usam, o
 * estado e «Retirar o som» (deixa de tocar em todo o lado, também depois de apagar a tcheka de onde saiu). Não se desfaz.
 */
export default function MySounds() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ['sounds', 'mine'], queryFn: soundsApi.mine });
  const [busy, setBusy] = useState<string | null>(null);

  async function retire(x: MySound) {
    if (!(await confirm({ title: RETIRE_SOUND_TITLE, message: RETIRE_SOUND_TEXT, confirm: 'Retirar', danger: true }))) return;
    setBusy(x.id);
    soundsApi
      .retire(x.id)
      .then(() => qc.invalidateQueries({ queryKey: ['sounds'] }))
      .catch((e) => showToast(e instanceof ApiError && e.message ? e.message : 'Não consegui retirar o som. Tenta outra vez daqui a pouco.'))
      .finally(() => setBusy(null));
  }

  const items = q.data ?? [];
  return (
    <SettingsPage title="Os meus sons">
      <SettingsSection note="O som de cada tcheka que publicaste com o som do próprio vídeo. Retirar um som tira-o de todo o lado: as tchekas que o usam ficam sem som. A tcheka de onde saiu fica como está.">
        {q.isLoading ? <PageLoader style={{ paddingTop: 24 }} /> : null}
        {q.isError ? <ErrorState what="os teus sons" onRetry={() => void q.refetch()} style={{ marginTop: 24, marginBottom: 24 }} /> : null}
        {q.isSuccess && !items.length ? <Text style={st.empty}>Ainda não tens sons. Publica uma tcheka com o som do vídeo.</Text> : null}
        {items.map((x) => {
          const st8 = mySoundStatus(x);
          const open = x.status === 'active' || x.status === 'held';
          return (
            <View key={x.id} style={st.row}>
              <Pressable onPress={open ? () => router.push(soundHref(x.id) as never) : undefined} disabled={!open} style={st.cover} accessibilityRole={open ? 'link' : undefined} accessibilityLabel={open ? 'Abrir a página do som' : undefined}>
                {x.cover ? <Image source={{ uri: sized(x.cover, 120) }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : <Icon name="music" size={18} color={colors.zinc500} />}
              </Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.title} numberOfLines={1}>{usesLine(x.uses)}</Text>
                <Text style={st.desc}>{st8.text}</Text>
              </View>
              {st8.canRetire ? (
                <Button label="Retirar o som" kind="danger" size="sm" loading={busy === x.id} onPress={() => void retire(x)} />
              ) : null}
            </View>
          );
        })}
      </SettingsSection>
    </SettingsPage>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  cover: { width: 48, height: 48, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  desc: { fontSize: 13, color: colors.zinc600, marginTop: 2 },
  empty: { fontSize: 14, color: colors.zinc600, padding: 16 },
});
