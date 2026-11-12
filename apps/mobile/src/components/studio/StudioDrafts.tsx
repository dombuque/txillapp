import { Image } from 'expo-image';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { agoLabel, draftLabel, type StudioDraft } from '@/lib/studio/drafts';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';

/**
 * «Continuar o rascunho?» ao abrir o estúdio das tchekas: o mais recente em destaque (Continuar / Começar de novo) e a lista
 * «Rascunhos» com os outros, cada um com Abrir e Apagar.
 */
export function StudioDrafts({ drafts, onContinue, onDelete, onNew }: {
  drafts: StudioDraft[];
  onContinue: (d: StudioDraft) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  const [first, ...rest] = drafts;
  const confirmDelete = (d: StudioDraft) => Alert.alert('Apagar o rascunho?', 'Os clipes e as edições deste rascunho saem deste aparelho.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Apagar', style: 'destructive', onPress: () => onDelete(d.id) },
  ]);
  const poster = (d: StudioDraft, big: boolean) => (
    <View style={[big ? st.posterBig : st.poster]}>
      {d.poster ? <Image source={{ uri: d.poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="film" size={big ? 28 : 18} color="rgba(255,255,255,0.6)" />}
    </View>
  );
  if (!first) return null;
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
      <View style={st.hero}>
        {poster(first, true)}
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={st.heroTitle} numberOfLines={1}>{draftLabel(first)}</Text>
          <Text style={st.sub}>Guardado {agoLabel(first.savedAt)}</Text>
          <Text style={st.sub}>Continua de onde ficaste: os cortes, a ordem e a música ficaram.</Text>
        </View>
        <Pressable onPress={() => confirmDelete(first)} hitSlop={8} style={st.trash} accessibilityRole="button" accessibilityLabel="Apagar o rascunho">
          <Icon name="trash" size={18} color="#fff" />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Pressable onPress={onNew} style={[st.btn, st.ghost]} accessibilityRole="button"><Text style={st.btnText}>Começar de novo</Text></Pressable>
        <Pressable onPress={() => onContinue(first)} style={[st.btn, st.primary]} accessibilityRole="button"><Text style={st.btnText}>Continuar</Text></Pressable>
      </View>
      {rest.length ? (
        <>
          <Text style={st.section}>Rascunhos</Text>
          <ScrollView style={{ maxHeight: 230 }} showsVerticalScrollIndicator={false}>
            {rest.map((d) => (
              <View key={d.id} style={st.row}>
                {poster(d, false)}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.rowTitle} numberOfLines={1}>{draftLabel(d)}</Text>
                  <Text style={st.sub}>{agoLabel(d.savedAt)}</Text>
                </View>
                <Pressable onPress={() => onContinue(d)} style={st.small} accessibilityRole="button" accessibilityLabel={`Abrir o rascunho de ${draftLabel(d)}`}><Text style={st.smallText}>Abrir</Text></Pressable>
                <Pressable onPress={() => confirmDelete(d)} hitSlop={8} style={st.trash} accessibilityRole="button" accessibilityLabel="Apagar o rascunho">
                  <Icon name="trash" size={16} color="#fff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, padding: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,79,109,0.35)' },
  posterBig: { width: 64, height: 112, borderRadius: 12, overflow: 'hidden', backgroundColor: '#1d1d26', alignItems: 'center', justifyContent: 'center' },
  poster: { width: 36, height: 62, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1d1d26', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.62)', fontSize: 14 },
  trash: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  btn: { flex: 1, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  ghost: { backgroundColor: 'rgba(255,255,255,0.1)' },
  primary: { backgroundColor: colors.brand },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  section: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 18, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  rowTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  small: { height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  smallText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
