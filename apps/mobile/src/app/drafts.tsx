import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PageLoader } from '@/components/PontoLoader';
import { EmptyState } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { IconButton } from '@/components/ui/IconButton';
import { useAuth } from '@/lib/auth';
import { clearDraft, listDrafts, restoreDraft, type DraftItem } from '@/lib/drafts';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { showToast } from '@/lib/toast';

/** Os teus rascunhos: o início do texto, a miniatura da foto e há quanto tempo foram guardados. Toca para continuar. */
export default function Drafts() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<DraftItem[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user) void listDrafts(user.username).then(setItems);
    }, [user]),
  );

  /** Apagar: sai logo da lista e o aviso de baixo deixa «Desfazer» (o rascunho volta ao mesmo lugar). */
  async function drop(d: DraftItem) {
    await clearDraft(d.key);
    setItems((l) => (l ?? []).filter((x) => x.key !== d.key));
    showToast('Rascunho apagado', {
      label: 'Desfazer',
      onPress: () => {
        void restoreDraft(d).then(() => setItems((l) => [...(l ?? []).filter((x) => x.key !== d.key), d].sort((a, b) => b.savedAt - a.savedAt)));
      },
    });
  }

  return (
    <StackPage title="Rascunhos">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}>
        {items === null && <PageLoader />}
        {items?.length === 0 && <EmptyState icon="file-text" title="Sem rascunhos" text="Quando saíres de uma publicação sem a publicar, podes guardá-la aqui." />}
        {items?.map((d) => {
          const photos = d.photos.length;
          const label = d.body.trim() || (photos ? `${photos} ${photos === 1 ? 'foto' : 'fotos'}` : 'Sem texto');
          return (
            <View key={d.key} style={st.row}>
              <Pressable onPress={() => router.push({ pathname: '/new', params: { draft: d.key } } as never)} accessibilityRole="button" style={({ pressed }) => [st.open, pressed && { backgroundColor: colors.zinc100 }]}>
                {d.photos[0] ? (
                  <Image source={{ uri: d.photos[0].uri }} style={st.thumb} contentFit="cover" />
                ) : (
                  <View style={[st.thumb, { backgroundColor: colors.zinc200, alignItems: 'center', justifyContent: 'center' }]}><Icon name="file-text" size={22} color={colors.zinc500} /></View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc800 }} numberOfLines={2}>{label}</Text>
                  <Text style={{ fontSize: 12, color: colors.zinc500 }}>{timeAgo(new Date(d.savedAt).toISOString())}{photos > 0 && d.body.trim() ? ` · ${photos} ${photos === 1 ? 'foto' : 'fotos'}` : ''}</Text>
                </View>
              </Pressable>
              <IconButton icon="trash" iconSize={20} color={colors.danger} label="Apagar rascunho" onPress={() => void drop(d)} />
            </View>
          );
        })}
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, backgroundColor: colors.zinc50, borderWidth: 1, borderColor: colors.zinc100, padding: 8 },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 4 },
  thumb: { width: 56, height: 56, borderRadius: 12 },
});
