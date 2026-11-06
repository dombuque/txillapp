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
  return <SvgXml xml={s.svg} width={size} height={Math.round(size * 1.12)} />;
}

/** Painel de stickers por categoria (toca num para o enviar). */
export function StickerPanel({ onPick }: { onPick: (id: string) => void }) {
  const [cat, setCat] = useState(CATS[0].id);
  const shown = useMemo(() => ITEMS.filter((s) => s.cat === cat), [cat]);
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
        {CATS.map((c) => (
          <Pressable key={c.id} onPress={() => setCat(c.id)} style={[styles.cat, { backgroundColor: cat === c.id ? colors.zinc900 : colors.zinc100 }]} accessibilityRole="tab" accessibilityState={{ selected: cat === c.id }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: cat === c.id ? '#fff' : colors.zinc800 }}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        data={shown}
        numColumns={4}
        keyExtractor={(s) => s.id}
        style={{ height: 230 }}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 8 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => onPick(item.id)} style={styles.cell} accessibilityRole="button" accessibilityLabel={`Sticker: ${item.text}`}>
            <SvgXml xml={item.svg} width={72} height={80} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: 1, borderTopColor: colors.zinc100, backgroundColor: colors.white, marginTop: 8 },
  cats: { gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  cat: { height: 34, borderRadius: 17, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  cell: { flex: 1 / 4, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
});
