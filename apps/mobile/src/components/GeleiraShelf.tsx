import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { geleiraApi, type MyTaste, type TasteItem, type TheirTaste } from '@/lib/api.geleira';
import { ICE, KINDS, KIND_ICON, KIND_LABEL } from '@/lib/geleira';
import { colors } from '@/lib/theme';
import { FridgeArt, LEVEL_LABEL, geleiraLevel, geleiraPoints, nextLevelHint } from './FridgeArt';
import { Icon, type IconName } from './Icon';
import { TasteBubble } from './TasteBubble';

type Shown = TasteItem & { rating: number | null; favorite: boolean };

/** A nota como temperatura: quanto mais gelado, mais forte o gosto (1 ° é "gelada de rachar"). Sem pontinhos. */
const TEMP = ['', '18°', '12°', '8°', '4°', '1°'];
const TEMP_BG = ['', colors.zinc100, colors.zinc100, colors.zinc200, colors.zinc700, colors.zinc900];
const TEMP_FG = ['', colors.zinc500, colors.zinc600, colors.zinc700, '#fff', '#fff'];
function Frost({ rating }: { rating: number | null }) {
  if (!rating) return <View style={{ marginTop: 2, height: 14 }} />;
  return (
    <View style={[st.frost, { backgroundColor: TEMP_BG[rating] }]}>
      <Icon name="snowflake" size={9} strokeWidth={2.4} color={TEMP_FG[rating]} />
      <Text style={{ fontSize: 9.5, fontWeight: '700', lineHeight: 14, color: TEMP_FG[rating] }}>{TEMP[rating]}</Text>
    </View>
  );
}

/** Um gosto: bolinha de vidro com o ícone, o nome e a nota. O favorito leva um coração. */
function Tile({ item }: { item: Shown }) {
  const label = `${item.name}${item.rating ? `, ${ICE[item.rating]}` : ''}${item.favorite ? ', favorito' : ''}`;
  return (
    <View style={st.tile} accessible accessibilityRole="image" accessibilityLabel={label}>
      <View>
        <TasteBubble item={item} size={44} />
        {item.favorite && (
          <View style={st.heart}>
            <Icon name="heart" size={9} solid color="#fff" />
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={st.tileName}>{item.name}</Text>
      {item.pending ? <Text style={{ marginTop: 4, fontSize: 10, fontWeight: '500', color: colors.zinc500 }}>à espera</Text> : <Frost rating={item.rating} />}
    </View>
  );
}

/** Prateleira: os gostos em fila e, por baixo, a tábua de vidro. */
function Shelf({ title, icon, items }: { title: string; icon: IconName; items: Shown[] }) {
  return (
    <View style={{ marginTop: 12 }}>
      <View style={st.shelfHead}>
        <Icon name={icon} size={14} color="rgba(39,39,42,0.7)" />
        <Text style={st.shelfTitle}>{title}</Text>
        <Text style={[st.shelfTitle, { color: 'rgba(39,39,42,0.45)', fontWeight: '600' }]}>{items.length}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 8 }} style={{ marginHorizontal: -4 }}>
        {items.map((i) => <Tile key={i.id} item={i} />)}
      </ScrollView>
      <LinearGradient colors={['rgba(228,228,231,0.7)', '#fff', 'rgba(228,228,231,0.7)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.board} />
    </View>
  );
}

function useTastes(username: string, isMe: boolean) {
  return useQuery({ queryKey: ['geleira', isMe ? 'me' : username], queryFn: (): Promise<(MyTaste | TheirTaste)[]> => (isMe ? geleiraApi.mine() : geleiraApi.of(username)), retry: false });
}

/** Botão da geleira na linha de ações do perfil: abre/fecha a prateleira para baixo. Nos perfis dos outros só aparece se houver o que mostrar. */
export function GeleiraToggle({ username, isMe, open, onToggle, icon = false, grow = false }: { username: string; isMe: boolean; open: boolean; onToggle: () => void; icon?: boolean; grow?: boolean }) {
  const q = useTastes(username, isMe);
  const shown = (q.data ?? []).filter((i) => i.kind === 'bebida' || i.kind === 'comida');
  if (!isMe && (q.isError || shown.length === 0)) return null;
  const fg = open ? '#fff' : colors.zinc900;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={open ? 'Fechar a geleira' : 'Abrir a geleira'}
      style={[st.toggle, { backgroundColor: open ? colors.zinc900 : colors.zinc100 }, icon ? (grow ? { flex: 1 } : { width: 44, paddingHorizontal: 0 }) : { flex: 1 }]}
    >
      <FridgeArt count={shown.length} level={geleiraLevel(geleiraPoints(shown.filter((i) => !i.pending)))} open={open} size={24} />
      {!icon && <Text style={{ fontSize: 14, fontWeight: '700', color: fg }}>Geleira</Text>}
      {!icon && <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><Icon name="chevron-right" size={14} color={fg} /></View>}
    </Pressable>
  );
}

/**
 * A geleira: vitrine de gostos (bebidas e comidas), só para ver. Editar fica em /geleira. Nos perfis dos outros só mostra o que a pessoa deixa ver.
 * `compact`: fechada por omissão (cabeçalho e o frigorífico); toca-se para abrir as prateleiras.
 */
export function GeleiraShelf({ username, isMe, flush = false, compact = false, pointed = false }: { username: string; isMe: boolean; flush?: boolean; compact?: boolean; pointed?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const q = useTastes(username, isMe);
  const items = (q.data ?? []).filter((i) => i.kind === 'bebida' || i.kind === 'comida');
  const lv = useQuery({ queryKey: ['geleira-level', username], queryFn: () => geleiraApi.level(username), retry: false, staleTime: 60_000 });
  const margin = flush ? 0 : 16;
  if (q.isLoading) return <View style={[st.skel, { marginHorizontal: margin, height: compact ? 60 : 192 }]} accessibilityLabel="A carregar a geleira" />;
  if (!isMe && (q.isError || items.length === 0)) return null;

  const favorites = items.filter((i) => i.favorite).slice(0, 8);
  const total = items.filter((i) => !i.pending).length;
  const points = geleiraPoints(items);
  const level = lv.data?.level ?? geleiraLevel(points);
  const title = lv.data ? lv.data.title : LEVEL_LABEL[level];
  // Frase de progresso: não aparece no cartão do site, mas serve de legenda ao nível (como no site, vem do servidor).
  const hint = lv.data
    ? lv.data.toNext === null
      ? `Nível máximo: ${lv.data.title.toLowerCase()}!`
      : `${lv.data.toNext === 1 ? 'Falta 1 ponto' : `Faltam ${lv.data.toNext} pontos`} para ${(lv.data.nextTitle ?? '').toLowerCase()}. Bebidas com álcool e vibes de festa valem mais.`
    : nextLevelHint(points);
  const folded = compact && !open;

  const body = (
    <>
      <View style={st.head}>
        {compact ? (
          <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? 'Fechar a geleira' : 'Abrir a geleira'}>
            <FridgeArt count={total} level={level} open={!folded} invite={folded} size={folded ? 64 : 56} />
          </Pressable>
        ) : (
          <FridgeArt count={total} level={level} open={!folded} size={52} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', lineHeight: 20, color: colors.zinc900 }}>{isMe ? 'A minha geleira' : 'Geleira'}</Text>
          <Text style={{ fontSize: 12, lineHeight: 16, color: colors.zinc600 }}>
            {items.length === 0 ? 'Ainda vazia' : `${total} ${total === 1 ? 'gosto' : 'gostos'}${favorites.length ? ` · ${favorites.length} ${favorites.length === 1 ? 'favorito' : 'favoritos'}` : ''}`}
          </Text>
          {total > 0 && (
            <View style={st.level} accessibilityHint={hint}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brand }}>{title}</Text>
            </View>
          )}
        </View>
      </View>

      {items.length === 0 && (!compact || open) ? (
        <View style={st.empty}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.zinc900 }}>Geleira vazia!</Text>
          <Text style={{ marginTop: 4, maxWidth: 272, textAlign: 'center', fontSize: 16, lineHeight: 24, color: colors.zinc600 }}>
            {isMe ? 'Para a encher, abre Editar perfil e escolhe a tua geleira.' : 'Ainda não há nada para mostrar.'}
          </Text>
        </View>
      ) : (
        !folded &&
        items.length > 0 &&
        KINDS.map((k) => {
          const list = items.filter((i) => i.kind === k).sort((a, b) => Number(b.favorite) - Number(a.favorite)); // os favoritos primeiro
          return list.length ? <Shelf key={k} title={KIND_LABEL[k]} icon={KIND_ICON[k]} items={list} /> : null;
        })
      )}
    </>
  );

  const cardStyle = [st.card, { marginHorizontal: margin, borderColor: pointed ? colors.zinc300 : colors.zinc200, paddingTop: folded ? 12 : 16 }];
  const inner = (
    <LinearGradient colors={['#fafafa', '#fff', 'rgba(255,255,255,0.6)']} style={StyleSheet.absoluteFill} />
  );
  // Fechada, qualquer parte do cartão abre a geleira.
  return folded ? (
    <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Abrir a geleira" accessibilityState={{ expanded: false }} style={cardStyle}>
      {inner}
      {body}
    </Pressable>
  ) : (
    <View style={cardStyle} accessibilityLabel="Geleira">
      {inner}
      {body}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginTop: 16, overflow: 'hidden', borderRadius: 24, borderWidth: 1, paddingHorizontal: 16, paddingBottom: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.1)', backgroundColor: '#fff' },
  skel: { marginTop: 16, borderRadius: 24, backgroundColor: colors.zinc100 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  level: { alignSelf: 'flex-start', marginTop: 2, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 8 },
  empty: { marginTop: 16, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.zinc100, backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 16, paddingVertical: 24 },
  frost: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'center', borderRadius: 999, paddingHorizontal: 6, height: 14 },
  tile: { width: 58, alignItems: 'center' },
  tileName: { marginTop: 4, minHeight: 23, width: '100%', textAlign: 'center', fontSize: 11, fontWeight: '600', lineHeight: 11.5, color: colors.zinc800 },
  heart: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shelfHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2, marginBottom: 4 },
  shelfTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1.44, textTransform: 'uppercase', color: 'rgba(39,39,42,0.7)' },
  board: { height: 4, borderRadius: 999, boxShadow: '0 3px 5px rgba(0,0,0,0.18)' },
  toggle: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 12 },
});
