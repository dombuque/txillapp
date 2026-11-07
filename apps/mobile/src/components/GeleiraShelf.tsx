import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { geleiraApi, type MyTaste, type TasteItem, type TheirTaste } from '@/lib/api.geleira';
import { ICE, KINDS, KIND_ICON, KIND_LABEL } from '@/lib/geleira';
import { colors } from '@/lib/theme';
import { FridgeArt, LEVEL_LABEL, geleiraLevel, geleiraPoints, nextLevelHint } from './FridgeArt';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';
import { TasteBubble } from './TasteBubble';

type Shown = TasteItem & { rating: number | null; favorite: boolean };

/** A nota em flocos de neve, de 1 a 5 (os mesmos do editor): mais flocos, mais gelado, mais gostas. */
const SKY = '#0ea5e9';
function Frost({ rating }: { rating: number | null }) {
  if (!rating) return <View style={{ marginTop: 2, height: 14 }} />;
  return (
    <View style={st.frost}>
      {[1, 2, 3, 4, 5].map((n) => <Icon key={n} name="snowflake" size={9} strokeWidth={2.6} color={n <= rating ? SKY : colors.zinc200} />)}
    </View>
  );
}

/** Como funciona a geleira: os flocos, o coração e os níveis. Abre ao tocar no nível. */
function HowSheet({ onClose, level, points, toNext, nextTitle }: { onClose: () => void; level: number; points: number; toNext: number | null; nextTitle: string | null }) {
  const steps = [0, 1, 12, 30, 60];
  return (
    <Sheet title="Como funciona a geleira" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 24, gap: 18 }}>
        <View style={{ gap: 8 }}>
          <Text style={st.howTitle}>Os flocos são a nota</Text>
          {[1, 2, 3, 4, 5].map((n) => (
            <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 1, width: 64 }}>{[1, 2, 3, 4, 5].map((k) => <Icon key={k} name="snowflake" size={11} strokeWidth={2.6} color={k <= n ? SKY : colors.zinc200} />)}</View>
              <Text style={st.howText}>{ICE[n]}</Text>
            </View>
          ))}
          <Text style={[st.howText, { color: colors.zinc500 }]}>Quanto mais gelado, mais gostas. Dás a nota no editor da geleira.</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[st.heart, { position: 'relative', right: 0, top: 0 }]}><Icon name="heart" size={9} solid color="#fff" /></View>
          <Text style={st.howText}>O coração marca os teus favoritos (até 8).</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={st.howTitle}>O nível da geleira</Text>
          <Text style={st.howText}>Ganhas pontos por cada gosto, por cada favorito, por variedade (grupos diferentes) e por dares notas.</Text>
          {LEVEL_LABEL.map((l, n) => (
            <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[st.lvDot, n === level && { backgroundColor: colors.brand }]}>{n === level && <Icon name="check" size={10} strokeWidth={3} color="#fff" />}</View>
              <Text style={[st.howText, n === level && { fontWeight: '800', color: colors.zinc900 }]}>{l}</Text>
              <Text style={[st.howText, { marginLeft: 'auto', color: colors.zinc500 }]}>{n === 0 ? '0 pontos' : `${steps[n]}+ pontos`}</Text>
            </View>
          ))}
          <Text style={[st.howText, { color: colors.zinc500 }]}>{toNext === null ? `Estás no máximo com ${points} pontos.` : `Tens ${points} ${points === 1 ? 'ponto' : 'pontos'}. ${toNext === 1 ? 'Falta 1' : `Faltam ${toNext}`} para ${(nextTitle ?? '').toLowerCase()}.`}</Text>
        </View>
      </View>
    </Sheet>
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
export function GeleiraShelf({ username, isMe, flush = false, compact = false, pointed = false, arrowRight = 11 }: { username: string; isMe: boolean; flush?: boolean; compact?: boolean; pointed?: boolean; arrowRight?: number }) {
  const [open, setOpen] = useState(!compact);
  const [how, setHow] = useState(false);
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
  // Progresso dentro do nível atual (0–1), para a barrinha.
  const stepsAll = [0, 1, 12, 30, 60];
  const lo = stepsAll[level], hi = level >= 4 ? null : stepsAll[level + 1];
  const progress = hi === null ? 1 : Math.max(0, Math.min(1, (points - lo) / (hi - lo)));

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
            <Pressable onPress={() => setHow(true)} style={st.level} accessibilityRole="button" accessibilityLabel={`Nível: ${title}`} accessibilityHint={hint}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brand }}>{title}</Text>
              <Icon name="info" size={12} strokeWidth={2.4} color={colors.brand} />
            </Pressable>
          )}
          {total > 0 && isMe && (
            <View style={{ marginTop: 6, gap: 3 }}>
              <View style={st.barTrack}><View style={[st.barFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
              <Text style={{ fontSize: 11, lineHeight: 14, color: colors.zinc500 }} numberOfLines={2}>{hint}</Text>
            </View>
          )}
        </View>
      </View>

      {how && <HowSheet onClose={() => setHow(false)} level={level} points={lv.data?.points ?? points} toNext={lv.data ? lv.data.toNext : level >= 4 ? null : stepsAll[level + 1] - points} nextTitle={lv.data ? lv.data.nextTitle : level >= 4 ? null : LEVEL_LABEL[level + 1]} />}
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
  arrow: { position: 'absolute', top: 6, zIndex: 10, width: 0, height: 0, borderLeftWidth: 11, borderRightWidth: 11, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: colors.zinc300 },
  card: { marginTop: 16, overflow: 'hidden', borderRadius: 24, borderWidth: 1, paddingHorizontal: 16, paddingBottom: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.1)', backgroundColor: '#fff' },
  skel: { marginTop: 16, borderRadius: 24, backgroundColor: colors.zinc100 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  level: { alignSelf: 'flex-start', marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 8, height: 20 },
  empty: { marginTop: 16, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.zinc100, backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 16, paddingVertical: 24 },
  frost: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 1, alignSelf: 'center', height: 14 },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: colors.zinc100, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.brand },
  howTitle: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  howText: { fontSize: 14, lineHeight: 19, color: colors.zinc700 },
  lvDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.zinc200, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 58, alignItems: 'center' },
  tileName: { marginTop: 4, minHeight: 23, width: '100%', textAlign: 'center', fontSize: 11, fontWeight: '600', lineHeight: 11.5, color: colors.zinc800 },
  heart: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shelfHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2, marginBottom: 4 },
  shelfTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1.44, textTransform: 'uppercase', color: 'rgba(39,39,42,0.7)' },
  board: { height: 4, borderRadius: 999, boxShadow: '0 3px 5px rgba(0,0,0,0.18)' },
  toggle: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 12 },
});
