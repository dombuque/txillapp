import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { composeApi, type PhotoTag } from '@/lib/api.compose';
import { colors } from '@/lib/theme';

const MAX_TAGS = 10;

/** Identificar pessoas numa foto: toca onde a pessoa está e escolhe quem é. Posição manual, sem reconhecimento facial. */
export function PhotoTagger({ src, tags, onDone }: { src: string; tags: PhotoTag[]; onDone: (tags: PhotoTag[]) => void }) {
  const insets = useSafeAreaInsets();
  const [list, setList] = useState(tags);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [ratio, setRatio] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim().replace(/^@/, '')), 150);
    return () => clearTimeout(t);
  }, [q]);

  const found = useQuery({ queryKey: ['mentionable', debounced], queryFn: () => composeApi.mentionable(debounced), enabled: !!pending, staleTime: 60_000, retry: false });
  const taken = new Set(list.map((t) => t.username.toLowerCase()));
  const people = (found.data ?? []).filter((p) => !taken.has(p.username.toLowerCase()));

  // A foto inteira (sem cortes), centrada: as etiquetas seguem a foto, não o ecrã.
  const fit = area.w && area.h ? (ratio > area.w / area.h ? { w: area.w, h: area.w / ratio } : { w: area.h * ratio, h: area.h }) : { w: 0, h: 0 };
  const left = (area.w - fit.w) / 2;
  const top = (area.h - fit.h) / 2;

  function choose(p: { username: string; displayName: string }) {
    if (!pending) return;
    setList([...list, { username: p.username, displayName: p.displayName, x: pending.x, y: pending.y }]);
    setPending(null);
    setQ('');
  }

  return (
    <Modal visible animationType="fade" onRequestClose={() => (pending ? setPending(null) : onDone(list))} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: '#000', paddingTop: Math.max(insets.top, 16) }}>
        <View style={styles.top}>
          <Text style={styles.title}>Identificar pessoas</Text>
          <Pressable onPress={() => onDone(list)} style={styles.done} accessibilityRole="button"><Text style={styles.doneText}>Feito</Text></Pressable>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 8 }} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {fit.w > 0 && (
            <View style={{ position: 'absolute', left: left + 8, top, width: fit.w, height: fit.h }}>
              <Pressable
                style={StyleSheet.absoluteFill}
                accessibilityLabel="Foto a identificar"
                onPress={(e) => {
                  if (list.length >= MAX_TAGS) return;
                  const { locationX, locationY } = e.nativeEvent;
                  setPending({ x: Math.min(1, Math.max(0, locationX / fit.w)), y: Math.min(1, Math.max(0, locationY / fit.h)) });
                }}
              >
                <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="contain" onLoad={(e) => e.source.width && e.source.height && setRatio(e.source.width / e.source.height)} />
              </Pressable>
              {pending ? <View pointerEvents="none" style={[styles.dot, { left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }]} /> : null}
              {list.map((t, i) => (
                <View key={`${t.username}-${i}`} style={[styles.tag, { left: `${t.x * 100}%`, top: `${t.y * 100}%` }, t.x < 0.22 ? null : t.x > 0.78 ? { transform: [{ translateX: -120 }, { translateY: 10 }] } : { transform: [{ translateX: -50 }, { translateY: 10 }] }]}>
                  <Text style={styles.tagText} numberOfLines={1}>{t.username}</Text>
                  <Pressable onPress={() => setList(list.filter((_, n) => n !== i))} hitSlop={8} accessibilityLabel={`Tirar a identificação de ${t.username}`}><Icon name="x" size={12} color="#fff" /></Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        {!pending ? (
          <Text style={[styles.hint, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            {list.length >= MAX_TAGS ? `Máximo de ${MAX_TAGS} pessoas por foto.` : list.length ? 'Toca noutra pessoa para identificar, ou no botão de remover.' : 'Toca na foto, em cima da pessoa que queres identificar.'}
          </Text>
        ) : (
          <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: '55%' }]}>
            <View style={styles.searchRow}>
              <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Quem é? Procura um nome…" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar pessoa" autoCapitalize="none" autoCorrect={false} style={styles.search} />
              <Pressable onPress={() => setPending(null)} style={{ paddingHorizontal: 12, height: 44, justifyContent: 'center' }}><Text style={{ fontWeight: '600', color: colors.zinc600 }}>Cancelar</Text></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {people.map((p) => (
                <Pressable key={p.username} onPress={() => choose(p)} style={({ pressed }) => [styles.person, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
                  <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pName} numberOfLines={1}>{p.displayName}</Text>
                    <Text style={styles.pUser} numberOfLines={1}>@{p.username}</Text>
                  </View>
                </Pressable>
              ))}
              {found.isSuccess && people.length === 0 ? <Text style={styles.none}>Ninguém que possas identificar. Só podes identificar quem aceita menções.</Text> : null}
            </ScrollView>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  done: { height: 40, borderRadius: 20, backgroundColor: colors.brand, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { paddingHorizontal: 24, paddingTop: 12, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  dot: { position: 'absolute', width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: colors.brand },
  tag: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 120, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: '#fff', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  panel: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  search: { flex: 1, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, paddingHorizontal: 16, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 8, borderRadius: 12 },
  pName: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  pUser: { fontSize: 14, color: colors.zinc500 },
  none: { paddingVertical: 12, fontSize: 14, color: colors.zinc500 },
});
