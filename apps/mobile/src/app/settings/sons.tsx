import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { SettingsSection, settingsStyles as s } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { ApiError } from '@/lib/api';
import { soundsApi, type MySound } from '@/lib/api.sounds';
import { sized } from '@/lib/config';
import { mySoundStatus, RETIRE_SOUND_TEXT, RETIRE_SOUND_TITLE, soundHref, usesLine } from '@/lib/sounds';
import { colors } from '@/lib/theme';

/**
 * Definições › Conteúdo › «Os meus sons»: os sons originais das minhas tchekas (docs/sons.md), quantas tchekas os usam, o
 * estado e «Retirar o som» (deixa de tocar em todo o lado, também depois de apagar a tcheka de onde saiu). Não se desfaz.
 */
export default function MySounds() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ['sounds', 'mine'], queryFn: soundsApi.mine });
  const [busy, setBusy] = useState<string | null>(null);

  function retire(x: MySound) {
    Alert.alert(RETIRE_SOUND_TITLE, RETIRE_SOUND_TEXT, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Retirar',
        style: 'destructive',
        onPress: () => {
          setBusy(x.id);
          soundsApi
            .retire(x.id)
            .then(() => qc.invalidateQueries({ queryKey: ['sounds'] }))
            .catch((e) => Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Tenta outra vez daqui a pouco.'))
            .finally(() => setBusy(null));
        },
      },
    ]);
  }

  const items = q.data ?? [];
  return (
    <SettingsPage title="Os meus sons">
      <SettingsSection note="O som de cada tcheka que publicaste com o som do próprio vídeo. Retirar um som tira-o de todo o lado: as tchekas que o usam ficam sem som. A tcheka de onde saiu fica como está.">
        {q.isLoading ? <ActivityIndicator style={{ margin: 24 }} color={colors.brand} /> : null}
        {q.isError ? <Text style={st.empty}>Não consegui abrir os teus sons. Tenta outra vez daqui a pouco.</Text> : null}
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
                <Pressable onPress={() => retire(x)} disabled={busy === x.id} style={[s.outline, busy === x.id && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Retirar o som">
                  <Text style={st.retire}>Retirar o som</Text>
                </Pressable>
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
  retire: { fontSize: 14, fontWeight: '700', color: colors.red600 },
  empty: { fontSize: 14, color: colors.zinc600, padding: 16 },
});
