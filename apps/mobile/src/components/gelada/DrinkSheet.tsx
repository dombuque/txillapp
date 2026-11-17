import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { geladaApi, geladaKeys, type DrinkChoice } from '@/lib/api.gelada';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';
import { ActivityIndicator } from '../PontoLoader';
import { Sheet } from '../Sheet';
import { TasteBubble } from '../TasteBubble';
import { t } from '@/lib/i18n';

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Escolher a bebida: as da minha geleira primeiro (o coração marca as favoritas), depois o catálogo, com pesquisa. As bebidas
 * vêm do servidor já sem álcool quando eu (ou alguém de `to`) tenho menos de 18 anos. Usado no «Paga-me uma», no «Fico a
 * dever-te uma» e no «Eu entro» da rodada.
 */
export function DrinkSheet({ title = t('Que bebida?'), to = [], selected, onPick, onClose }: { title?: string; to?: string[]; selected?: string | null; onPick: (d: DrinkChoice) => void; onClose: () => void }) {
  const q = useQuery({ queryKey: geladaKeys.drinks(to), queryFn: () => geladaApi.drinks(to), staleTime: 60_000 });
  const [text, setText] = useState('');
  const list = useMemo(() => {
    const all = q.data?.drinks ?? [];
    const t = norm(text.trim());
    return t ? all.filter((d) => norm(d.name).includes(t)) : all;
  }, [q.data, text]);
  const mine = list.filter((d) => d.mine);
  const rest = list.filter((d) => !d.mine);
  const row = (d: DrinkChoice) => {
    const on = selected === d.id;
    return (
      <Pressable
        key={d.id}
        onPress={() => onPick(d)}
        style={({ pressed }) => [st.row, on && st.rowOn, pressed && { backgroundColor: colors.zinc100 }]}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        accessibilityLabel={`${d.name}${d.favorite ? t(', favorita') : ''}`}
      >
        <TasteBubble item={{ slug: d.slug, kind: 'bebida', category: d.category }} size={40} />
        <Text style={st.name} numberOfLines={1}>{d.name}</Text>
        {d.favorite && <Icon name="heart" size={14} solid color={colors.brand} />}
        {on && <Icon name="check" size={18} color={colors.brand} />}
      </Pressable>
    );
  };
  return (
    <Sheet title={title} onClose={onClose} full>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={st.search}>
          <Icon name="search" size={18} color={colors.zinc500} />
          <TextInput value={text} onChangeText={setText} placeholder={t('Procurar bebida…')} placeholderTextColor={colors.zinc500} style={st.input} accessibilityLabel={t('Procurar bebida')} maxLength={40} />
        </View>
        {q.data?.soft ? <Text style={st.note}>{t('Só refrescos e sumos: há menores de 18 no pedido.')}</Text> : null}
      </View>
      {q.isLoading && <ActivityIndicator color={colors.brand} style={{ paddingVertical: 24 }} />}
      {q.isError && <Text style={st.msg} accessibilityRole="alert">{t('Não consegui abrir as bebidas. Tenta outra vez.')}</Text>}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {mine.length > 0 && <Text style={st.section}>{t('Da tua geleira')}</Text>}
        {mine.map(row)}
        {rest.length > 0 && <Text style={st.section}>{mine.length ? t('Outras bebidas') : t('Bebidas')}</Text>}
        {rest.map(row)}
        {q.isSuccess && list.length === 0 && <Text style={st.msg}>{t('Nenhuma bebida com esse nome.')}</Text>}
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, paddingVertical: 0, outlineStyle: 'none' } as never,
  note: { marginTop: 8, fontSize: 13, color: colors.zinc600 },
  section: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.zinc500 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  rowOn: { backgroundColor: colors.rose50 },
  name: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  msg: { paddingVertical: 24, paddingHorizontal: 24, textAlign: 'center', color: colors.zinc600, fontSize: 16 },
});
