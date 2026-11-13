import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { ApiError, type Post } from '@/lib/api';
import { geleiraApi, type PostGeleira, type PostGeleiraItem } from '@/lib/api.geleira';
import { KIND_ICON, KIND_LABEL } from '@/lib/geleira';
import { applyItemCheer, itemA11yLabel, shelvesOf, tastesCount, toggleItemCheer } from '@/lib/geleiraPost';
import { mergePost } from '@/lib/postPatch';
import { colors } from '@/lib/theme';
import { CheersPour } from './CheersPour';
import { FridgeArt, LEVEL_LABEL } from './FridgeArt';
import { Icon } from './Icon';
import { TasteBubble } from './TasteBubble';

/**
 * A geleira partilhada num post (0143): o frigorífico aberto com as prateleiras, como o FridgeArt da geleira do perfil, com
 * os gostos do retrato (bebidas em cima, comidas em baixo). Quem vê toca num gosto para lhe brindar (o mesmo brinde que no
 * perfil: uma vez por pessoa e gosto); o dono vê quantos brindes tem cada um. O servidor já tirou as bebidas alcoólicas a
 * quem tem menos de 18 anos. Em baixo, «Ver a geleira de @x» abre a geleira de agora, no perfil.
 */

/** As cores da borda pelo nível (as mesmas do FridgeArt). */
const EDGE = ['#a9c9d9', '#8fd0ee', '#6fc4ea', '#f08aa0', '#e8a317'];
const SKY700 = '#0369a1';
const AMBER_INK = '#92400e';
/** No feed, até 3 prateleiras de 4 (o resto abre-se na página do post). */
const FEED_SHELVES = 3;
const PER_SHELF = 4;

/** O caminho para a geleira de agora: o meu perfil, ou o da pessoa, já com a geleira aberta. */
export const geleiraHref = (username: string, mine: boolean) => (mine ? '/profile?geleira=1' : `/u/${encodeURIComponent(username)}?geleira=1`);

/** Atualiza o post da geleira em todas as listas em memória (feed, perfil, página do post…), como o PostCard. */
function usePostPatch(id: string) {
  const qc = useQueryClient();
  return (p: Partial<Post>) => {
    for (const q of qc.getQueryCache().getAll()) {
      const d = q.state.data;
      if (d === undefined) continue;
      const next = mergePost(d, id, p as Record<string, unknown>);
      if (next !== d) qc.setQueryData(q.queryKey, next);
    }
  };
}

/** A porta aberta, do lado da dobradiça (como no FridgeArt), com a altura do frigorífico. */
function Door({ h, edge }: { h: number; edge: string }) {
  if (h <= 0) return <View style={{ width: 22 }} />;
  return (
    <Svg width={22} height={h} viewBox={`0 0 22 ${h}`} style={{ marginRight: -3 }}>
      <Path d={`M21 2 L2 ${Math.round(h * 0.06)} L2 ${Math.round(h * 0.94)} L21 ${h - 2} Z`} fill="#fff" stroke={edge} strokeWidth={3} strokeLinejoin="round" />
      <Path d={`M2 ${Math.round(h * 0.42)} L21 ${Math.round(h * 0.44)}`} stroke={edge} strokeWidth={2.5} />
      <Rect x={6} y={Math.round(h * 0.18)} width={3.5} height={Math.round(h * 0.13)} rx={1.7} fill="#9ab8c8" />
      <Rect x={6} y={Math.round(h * 0.52)} width={3.5} height={Math.round(h * 0.18)} rx={1.7} fill="#9ab8c8" />
    </Svg>
  );
}

/** Um gosto na prateleira: a bolinha com o desenho, o nome e os brindes. Brindado por mim: anel âmbar. */
function Tile({ item, width, mine, onPress }: { item: PostGeleiraItem; width: number; mine: boolean; onPress: () => void }) {
  const n = item.cheers;
  return (
    <Pressable
      onPress={mine ? undefined : onPress}
      disabled={mine}
      hitSlop={2}
      style={({ pressed }) => [{ width, alignItems: 'center', paddingTop: 4 }, pressed && { transform: [{ scale: 0.94 }] }]}
      accessibilityRole={mine ? 'image' : 'button'}
      accessibilityState={mine ? undefined : { selected: item.cheered }}
      accessibilityLabel={itemA11yLabel(item, mine)}
    >
      <View>
        <View style={[st.ring, item.cheered && st.ringOn]}>
          <TasteBubble item={item} size={44} />
        </View>
        {item.favorite ? (
          <View style={st.heart}>
            <Icon name="heart" size={8} solid color="#fff" />
          </View>
        ) : null}
        {n > 0 ? (
          <View style={[st.count, item.cheered && { backgroundColor: colors.amber300 }]}>
            <Icon name="cheers" size={9} color={AMBER_INK} />
            <Text style={st.countText}>{n > 99 ? '99+' : n}</Text>
          </View>
        ) : null}
      </View>
      <Text style={st.name} numberOfLines={2}>{item.name}</Text>
    </Pressable>
  );
}

/** A tábua de vidro de cada prateleira. */
const Board = () => <View style={st.board} />;

export function GeleiraPostCard({ post, me, detail = false, onOpen, preview = false }: { post: Pick<Post, 'id' | 'author' | 'geleira'>; me?: string; /** Na página do post: todas as prateleiras. */ detail?: boolean; /** Abre a página do post (o «e mais N»). */ onOpen?: () => void; /** No ecrã de publicar: só para ver (sem ligações nem brindes). */ preview?: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const patch = usePostPatch(post.id);
  const mine = preview || (!!me && post.author.id === me);
  // O estado fica também aqui: o cartão pode vir de uma lista que o patch não atualiza (conversas, pesquisa…).
  const [g, setG] = useState<PostGeleira | null>(post.geleira ?? null);
  useEffect(() => setG(post.geleira ?? null), [post.geleira]);
  const [h, setH] = useState(0);
  const [w, setW] = useState(0);
  const [burst, setBurst] = useState(0);
  const busy = useRef(new Set<string>());
  if (!g) return null;

  const edge = EDGE[Math.max(0, Math.min(4, g.level))];
  const { shelves, more } = shelvesOf(g, PER_SHELF, detail ? Infinity : FEED_SHELVES);
  const tileW = w > 0 ? Math.floor(w / PER_SHELF) : 64;
  const owner = post.author;

  async function toggle(item: PostGeleiraItem) {
    if (!g || busy.current.has(item.id)) return;
    busy.current.add(item.id);
    const before = g;
    const next = toggleItemCheer(g, item.id);
    setG(next);
    patch({ geleira: next });
    if (!item.cheered) {
      setBurst((k) => k + 1);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    try {
      const r = await geleiraApi.cheerPostItem(post.id, item.id, !item.cheered);
      setG((cur) => {
        const fixed = cur ? applyItemCheer(cur, r) : cur;
        if (fixed) patch({ geleira: fixed });
        return fixed;
      });
      // A geleira do perfil mostra os mesmos brindes.
      void qc.invalidateQueries({ queryKey: ['geleira', owner.username] });
    } catch (e) {
      setG(before);
      patch({ geleira: before });
      Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Não consegui brindar agora. Tenta outra vez.');
    } finally {
      busy.current.delete(item.id);
    }
  }

  let lastKind = '';
  return (
    <View style={st.wrap} accessibilityLabel={`Geleira de ${owner.displayName}, ${tastesCount(g.total)}`}>
      <LinearGradient colors={['#f0f9ff', '#ffffff', '#fdf2f8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={st.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.over}>A GELEIRA DE</Text>
          <Text style={st.title} numberOfLines={1}>{owner.displayName}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <View style={st.level}><Text style={st.levelText} numberOfLines={1}>{LEVEL_LABEL[g.level] ?? ''}</Text></View>
          <Text style={st.total}>{tastesCount(g.total)}</Text>
        </View>
      </View>

      <View style={st.fridgeRow}>
        <Door h={h} edge={edge} />
        <View style={[st.body, { borderColor: edge }]} onLayout={(e) => { const v = Math.round(e.nativeEvent.layout.height); if (v !== h) setH(v); }}>
          <LinearGradient colors={['#ffffff', g.level >= 3 ? '#fdeef1' : '#e4f1f8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[st.inside, { borderColor: edge }]} onLayout={(e) => { const v = Math.round(e.nativeEvent.layout.width) - 12; if (v > 0 && Math.abs(v - w) > 1) setW(v); }}>
            <LinearGradient colors={['#fffdf2', '#e2f3fb']} style={StyleSheet.absoluteFill} />
            <View style={st.light} />
            {shelves.map((s, k) => {
              const label = s.kind !== lastKind;
              lastKind = s.kind;
              return (
                <View key={`${s.kind}${k}`} style={{ marginTop: label && k > 0 ? 6 : 0 }}>
                  {label ? (
                    <View style={st.kind} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <Icon name={KIND_ICON[s.kind as 'bebida' | 'comida']} size={11} color="rgba(39,39,42,0.55)" />
                      <Text style={st.kindText}>{KIND_LABEL[s.kind as 'bebida' | 'comida']}</Text>
                    </View>
                  ) : null}
                  <View style={st.row}>
                    {s.items.map((i) => <Tile key={i.id} item={i} width={tileW} mine={mine} onPress={() => void toggle(i)} />)}
                  </View>
                  <Board />
                </View>
              );
            })}
          </View>
        </View>
      </View>
      <View style={st.feet} pointerEvents="none">
        <View style={st.foot} />
        <View style={st.foot} />
      </View>
      <CheersPour n={burst} size={150} />

      {preview ? (more > 0 ? <Text style={[st.moreText, { marginTop: 8 }]}>e mais {more}: veem-se todos ao abrir o post</Text> : null) : (
      <View style={st.foot2}>
        {more > 0 && !detail ? (
          <Pressable onPress={onOpen} hitSlop={6} style={({ pressed }) => [st.more, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Text style={st.moreText}>e mais {more}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push(geleiraHref(owner.username, mine) as never)}
          hitSlop={6}
          style={({ pressed }) => [st.link, pressed && { opacity: 0.7 }]}
          accessibilityRole="link"
          accessibilityHint="Abre a geleira de agora, no perfil"
        >
          <Text style={st.linkText} numberOfLines={1}>{mine ? 'Ver a minha geleira' : `Ver a geleira de @${owner.username}`}</Text>
          <Icon name="chevron-right" size={16} color={SKY700} />
        </Pressable>
      </View>
      )}
      {!mine ? <Text style={st.hint}>Toca num gosto para lhe brindar · o brinde fica na geleira de {owner.displayName.split(' ')[0]}</Text> : null}
    </View>
  );
}

/** A geleira em ponto pequeno (conversas, citações): o frigorífico, de quem é e os primeiros gostos. */
export function GeleiraMini({ geleira, name, ink = colors.zinc900 }: { geleira: PostGeleira; name: string; ink?: string }) {
  const first = geleira.items.slice(0, 5);
  const more = Math.max(0, geleira.total - first.length);
  return (
    <View style={st.mini} accessibilityLabel={`Geleira de ${name}, ${tastesCount(geleira.total)}`}>
      <LinearGradient colors={['#f0f9ff', '#fdf2f8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <FridgeArt count={geleira.items.length} level={geleira.level} open size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.miniTitle, { color: ink === '#fff' ? colors.zinc900 : ink }]} numberOfLines={1}>Geleira de {name}</Text>
        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center' }}>
          {first.map((i, k) => (
            <View key={i.id} style={{ marginLeft: k ? -6 : 0 }}>
              <TasteBubble item={i} size={28} />
            </View>
          ))}
          {more > 0 ? <Text style={st.miniMore}>+{more}</Text> : null}
        </View>
      </View>
    </View>
  );
}

/** O quadrado da grelha do perfil: o frigorífico aberto e quantos gostos. */
/**
 * A geleira partilhada na grelha do perfil: o mesmo frigorífico do post, em pequeno (a moldura azul, as prateleiras e os
 * primeiros gostos), para a grelha mostrar o que o post mostra.
 */
export function GeleiraGridTile({ geleira, size }: { geleira: PostGeleira; size: number }) {
  const cols = 3;
  const bubble = Math.max(18, Math.floor((size - 34) / cols) - 6);
  const shelves = [geleira.items.slice(0, cols), geleira.items.slice(cols, cols * 2)].filter((r) => r.length);
  const more = Math.max(0, geleira.total - shelves.flat().length);
  return (
    <LinearGradient colors={['#f0f9ff', '#ffffff', '#fdf2f8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { padding: 7 }]}>
      <Text style={[st.over, { fontSize: 9, letterSpacing: 1 }]} numberOfLines={1}>GELEIRA</Text>
      <View style={[st.body, { flex: 1, marginTop: 4, borderWidth: 2, borderRadius: 12, padding: 3, borderColor: '#7cc7e8' }]}>
        <LinearGradient colors={['#fffbeb', '#f0f9ff']} style={[st.inside, { flex: 1, borderRadius: 8, borderWidth: 1, borderColor: '#bae6fd', paddingTop: 8, paddingHorizontal: 3, paddingBottom: 3, justifyContent: 'space-evenly' }]}>
          <View style={[st.light, { width: 6, height: 6, top: 2 }]} />
          {shelves.length ? shelves.map((row, i) => (
            <View key={i}>
              <View style={[st.row, { justifyContent: 'space-around' }]}>
                {row.map((it) => <TasteBubble key={it.id} item={it} size={bubble} />)}
              </View>
              <View style={[st.board, { height: 3, marginTop: 2, marginBottom: 0 }]} />
            </View>
          )) : <FridgeArt count={0} level={geleira.level} open size={Math.round(size * 0.3)} />}
        </LinearGradient>
      </View>
      <Text style={{ marginTop: 3, fontSize: 10, fontWeight: '700', color: SKY700, textAlign: 'center' }} numberOfLines={1}>{more ? `${tastesCount(geleira.total)} · +${more}` : tastesCount(geleira.total)}</Text>
    </LinearGradient>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: 12, overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: '#e0f2fe', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  over: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: SKY700 },
  title: { marginTop: 1, fontSize: 19, lineHeight: 24, fontWeight: '800', color: colors.zinc900 },
  level: { maxWidth: 170, borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 8, height: 22, justifyContent: 'center' },
  levelText: { fontSize: 11, fontWeight: '700', color: colors.brand },
  total: { fontSize: 12, fontWeight: '600', color: colors.zinc600 },
  fridgeRow: { marginTop: 12, flexDirection: 'row', alignItems: 'stretch' },
  body: { flex: 1, overflow: 'hidden', borderRadius: 18, borderWidth: 3, padding: 5 },
  inside: { overflow: 'hidden', borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 6, paddingTop: 16, paddingBottom: 6 },
  light: { position: 'absolute', top: 4, alignSelf: 'center', width: 9, height: 9, borderRadius: 5, backgroundColor: '#fde68a', boxShadow: '0 0 10px 3px rgba(253,230,138,0.9)' },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 2, marginBottom: 2 },
  kindText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(39,39,42,0.55)' },
  row: { flexDirection: 'row' },
  board: { marginTop: 2, marginBottom: 4, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.95)', borderWidth: 1, borderColor: '#9fd6ee', boxShadow: '0 2px 3px rgba(14,116,144,0.18)' },
  ring: { borderRadius: 26, borderWidth: 2, borderColor: 'transparent', padding: 1 },
  ringOn: { borderColor: colors.amber300 },
  heart: { position: 'absolute', left: -3, top: -2, width: 17, height: 17, borderRadius: 9, backgroundColor: colors.brand, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', right: -9, top: -4, height: 18, minWidth: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 9, borderWidth: 1.5, borderColor: '#fff', paddingHorizontal: 4, backgroundColor: '#fef3c7' },
  countText: { fontSize: 10, lineHeight: 13, fontWeight: '800', color: AMBER_INK, includeFontPadding: false },
  name: { marginTop: 3, minHeight: 26, width: '100%', paddingHorizontal: 1, textAlign: 'center', fontSize: 11, lineHeight: 13, fontWeight: '600', color: colors.zinc800 },
  feet: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 40, paddingRight: 18 },
  foot: { width: 22, height: 7, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: '#7b9aab' },
  foot2: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  more: { height: 32, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.zinc200, paddingHorizontal: 12, justifyContent: 'center' },
  moreText: { fontSize: 13, fontWeight: '700', color: colors.zinc800 },
  link: { marginLeft: 'auto', minHeight: 32, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  linkText: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: SKY700 },
  hint: { marginTop: 4, fontSize: 12, lineHeight: 16, color: colors.zinc500 },
  mini: { overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  miniTitle: { fontSize: 14, fontWeight: '800' },
  miniMore: { marginLeft: 6, fontSize: 12, fontWeight: '700', color: colors.zinc600 },
});
