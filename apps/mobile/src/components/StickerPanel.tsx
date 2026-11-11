import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GifItem } from '@/lib/gifs';
import { STICKERS, STICKER_CATS, stickerById } from '@/lib/stickers';
import { colors } from '@/lib/theme';
import { GifPanel, useGifsConfig } from './GifPanel';
import { StickerArt } from './Stickers';

/** Sticker pelo id (o mesmo desenho em todo o lado; os animados mexem-se). Sem o id, mostra o texto. */
export function Sticker({ id, size = 132, animate = true }: { id: string; size?: number; animate?: boolean }) {
  const s = stickerById(id);
  if (!s) return <Text style={{ fontSize: 14, color: colors.zinc500 }}>Sticker</Text>;
  return <StickerArt def={s} size={size} animate={animate} />;
}

const RECENT_KEY = 'txill.stickers.recent';
let recentMem: string[] = [];
function readRecent(): string[] {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(RECENT_KEY);
    if (raw) recentMem = (JSON.parse(raw) as string[]).filter((id) => stickerById(id));
  } catch { /* sem armazenamento */ }
  return recentMem;
}

/**
 * Painel de stickers por categoria (os animados primeiro, os recentes antes de tudo); toca num para o enviar.
 * Com `onGif` e os GIFs ligados no servidor (GIPHY), tem também o separador "GIF" (components/GifPanel).
 */
export function StickerPanel({ onPick, onGif, start = 'stickers' }: { onPick: (id: string) => void; onGif?: (g: GifItem) => void; start?: 'stickers' | 'gif' }) {
  const gifs = useGifsConfig();
  const [mode, setMode] = useState<'stickers' | 'gif'>(start);
  const withGif = !!onGif && gifs.enabled;
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [cat, setCat] = useState<string>(() => (readRecent().length ? 'recentes' : STICKER_CATS[0].id));
  const tabs = [...(recent.length ? [{ id: 'recentes', label: 'Recentes' }] : []), ...STICKER_CATS];
  const shown = useMemo(() => (cat === 'recentes' ? recent.map((id) => stickerById(id)!).filter(Boolean) : STICKERS.filter((s) => s.cat === cat)), [cat, recent]);
  function pick(id: string) {
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, 8);
    recentMem = next;
    setRecent(next);
    try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* sem armazenamento */ }
    onPick(id);
  }
  return (
    <View style={styles.wrap} accessibilityLabel={withGif ? 'Stickers e GIFs' : 'Stickers'}>
      {withGif && (
        <View style={styles.modes} accessibilityRole="tablist">
          {([['stickers', 'Stickers'], ['gif', 'GIF']] as const).map(([id, label]) => (
            <Pressable key={id} onPress={() => setMode(id)} style={[styles.mode, mode === id && styles.modeOn]} accessibilityRole="tab" accessibilityState={{ selected: mode === id }} accessibilityLabel={id === 'gif' ? 'GIFs' : 'Stickers'}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: mode === id ? colors.zinc900 : colors.zinc500 }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {withGif && mode === 'gif' ? <GifPanel onPick={onGif!} height={260} /> : (<>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.cats}>
        {tabs.map((c) => (
          <Pressable key={c.id} onPress={() => setCat(c.id)} style={[styles.cat, { backgroundColor: cat === c.id ? colors.brand : colors.white }]} accessibilityRole="tab" accessibilityState={{ selected: cat === c.id }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: cat === c.id ? '#fff' : colors.zinc700 }}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        data={shown}
        numColumns={4}
        keyExtractor={(s) => s.id}
        style={{ maxHeight: 224 }}
        contentContainerStyle={{ padding: 8 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => pick(item.id)} style={({ pressed }) => [styles.cell, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel={`Enviar sticker ${item.text}`}>
            <StickerArt def={item} size={72} />
          </Pressable>
        )}
      />
      </>)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 12, marginTop: 8, overflow: 'hidden', borderRadius: 16, backgroundColor: '#fafafa' },
  cats: { gap: 4, paddingHorizontal: 8, paddingTop: 8 },
  modes: { flexDirection: 'row', gap: 4, marginHorizontal: 8, marginTop: 8, padding: 3, borderRadius: 22, backgroundColor: colors.zinc100 },
  mode: { flex: 1, height: 44, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  modeOn: { backgroundColor: colors.white, boxShadow: '0 1px 2px rgba(16,24,40,0.08)' } as object,
  cat: { height: 32, borderRadius: 16, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  cell: { flex: 1 / 4, margin: 2, height: 84, alignItems: 'center', justifyContent: 'center', borderRadius: 16, padding: 4 },
});
