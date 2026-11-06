import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PontoLoader } from '@/components/PontoLoader';
import { Empty } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { useAuth } from '@/lib/auth';
import { clearDraft, listDrafts, type DraftItem } from '@/lib/drafts';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

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

  async function drop(key: string) {
    await clearDraft(key);
    setItems((l) => (l ?? []).filter((d) => d.key !== key));
  }

  return (
    <StackPage title="Rascunhos">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}>
        {items === null && <View style={{ alignItems: "center", paddingVertical: 40 }}><PontoLoader size={20} /></View>}
        {items?.length === 0 && <Empty icon="file-text" title="Sem rascunhos." text="Quando saíres de uma publicação sem a publicar, podes guardá-la aqui." />}
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
              <Pressable onPress={() => void drop(d.key)} accessibilityRole="button" accessibilityLabel="Apagar rascunho" style={st.trash}><Icon name="trash" size={20} color={colors.red600} /></Pressable>
            </View>
          );
        })}
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc100, padding: 8 },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 4 },
  thumb: { width: 56, height: 56, borderRadius: 12 },
  trash: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
});
