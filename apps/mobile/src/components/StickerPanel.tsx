import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import data from '../assets/stickers.json';
import { colors } from '@/lib/theme';

interface Item { id: string; cat: string; text: string; svg: string }
const ITEMS = data.items as Item[];
const CATS = data.cats as { id: string; label: string }[];

/** Sticker pelo id (o mesmo desenho do site). Sem o id, mostra o texto. */
export function Sticker({ id, size = 132 }: { id: string; size?: number }) {
  const s = ITEMS.find((x) => x.id === id);
  if (!s) return <Text style={{ fontSize: 14, color: colors.zinc500 }}>Sticker</Text>;
  return <SvgXml xml={s.svg} width={size} height={Math.round(size * 0.98)} />;
}

const RECENT_KEY = 'txill.stickers.recent';
let recentMem: string[] = [];
function readRecent(): string[] {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(RECENT_KEY);
    if (raw) recentMem = (JSON.parse(raw) as string[]).filter((id) => ITEMS.some((x) => x.id === id));
  } catch { /* sem armazenamento */ }
  return recentMem;
}

/** Painel de stickers por categoria, como no site (com os recentes primeiro); toca num para o enviar. */
export function StickerPanel({ onPick }: { onPick: (id: string) => void }) {
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [cat, setCat] = useState<string>(() => (readRecent().length ? 'recentes' : CATS[0].id));
  const tabs = [...(recent.length ? [{ id: 'recentes', label: 'Recentes' }] : []), ...CATS];
  const shown = useMemo(() => (cat === 'recentes' ? recent.map((id) => ITEMS.find((x) => x.id === id)!).filter(Boolean) : ITEMS.filter((s) => s.cat === cat)), [cat, recent]);
  function pick(id: string) {
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, 8);
    recentMem = next;
    setRecent(next);
    try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* sem armazenamento */ }
    onPick(id);
  }
  return (
    <View style={styles.wrap} accessibilityLabel="Stickers">
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
            <SvgXml xml={item.svg} width={72} height={Math.round(72 * 1.12)} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 12, marginTop: 8, overflow: 'hidden', borderRadius: 16, backgroundColor: '#fafafa' },
  cats: { gap: 4, paddingHorizontal: 8, paddingTop: 8 },
  cat: { height: 32, borderRadius: 16, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  cell: { flex: 1 / 4, margin: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 16, padding: 4 },
});
