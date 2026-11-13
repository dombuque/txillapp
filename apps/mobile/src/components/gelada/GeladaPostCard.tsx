import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { type Post } from '@/lib/api';
import { geladaApi, type GeladaRequest, type PostGelada } from '@/lib/api.gelada';
import { drinkLabel, drinkPhrase, handleOf, postTitle, statusLine, geladaErrorText } from '@/lib/gelada';
import { mergePost } from '@/lib/postPatch';
import { colors } from '@/lib/theme';
import { Avatar } from '../Avatar';
import { CheersPour } from '../CheersPour';
import { DrinkArt } from '../DrinkArt';
import { Icon } from '../Icon';
import { AMBER_INK, AnswerButtons, useAnswerGelada } from './GeladaCard';

/** Atualiza o post em todas as listas em memória (feed, perfil, página do post…), como o GeleiraPostCard. */
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

const chip = (s: GeladaRequest['status']) =>
  s === 'accepted' ? { bg: '#dcfce7', fg: colors.green700 } : s === 'owed' ? { bg: '#fef3c7', fg: AMBER_INK } : { bg: colors.zinc100, fg: colors.zinc700 };

/** Uma pessoa identificada no pedido: o avatar, o @, o estado e (se é para mim) os três botões e «Tirar a minha identificação». */
function Line({ r, onAnswered, onUntag, untagging }: { r: GeladaRequest; onAnswered: (n: GeladaRequest) => void; onUntag: () => void; untagging: boolean }) {
  const router = useRouter();
  const { busy, answer } = useAnswerGelada(onAnswered);
  const p = r.recipient;
  const c = chip(r.status);
  const name = handleOf(p);
  return (
    <View style={st.line}>
      <View style={st.lineHead}>
        <Pressable disabled={!p?.username} onPress={() => p?.username && router.push(`/u/${p.username}` as never)} accessibilityRole="link" accessibilityLabel={r.forMe ? 'Tu' : name}>
          <Avatar name={p?.displayName ?? 'Conta eliminada'} username={p?.hasAvatar ? p.username : undefined} size={34} />
        </Pressable>
        <Text style={st.lineName} numberOfLines={1}>{r.forMe ? 'Tu' : name}</Text>
        {!r.canAnswer && (
          <View style={[st.chip, { backgroundColor: c.bg }]} accessibilityLiveRegion="polite">
            <Text style={[st.chipText, { color: c.fg }]} numberOfLines={1}>{statusLine(r.status, name, r.forMe)}</Text>
          </View>
        )}
      </View>
      {r.canAnswer ? (
        <View style={{ marginTop: 10 }}>
          <Text style={st.ask}>Pedem-te {drinkPhrase(r.drink)}. E então?</Text>
          <AnswerButtons busy={busy} name={handleOf(r.requester)} onAnswer={(a) => void answer(r.id, a)} />
        </View>
      ) : null}
      {r.canUntag ? (
        <Pressable disabled={untagging} onPress={onUntag} style={({ pressed }) => [st.untag, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityHint="Sais da publicação e o pedido fica fechado para ti">
          <Text style={st.untagText}>{untagging ? 'A tirar…' : 'Tirar a minha identificação'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * O «Paga-me uma» publicado (0145): a bebida desenhada, «@ana, @rui, paga-me uma 2M 🍺» e cada pessoa identificada com o seu
 * estado, que toda a gente que vê o post vê («@ana pagou 🍻», «@rui ficou a dever», «Hoje não»). Só quem foi identificado vê
 * os botões e pode tirar a identificação. Os outros brindam e comentam o post como de costume. O servidor já trocou a
 * bebida por «uma bebida» para quem tem menos de 18 anos.
 */
export function GeladaPostCard({ post, onOpen }: { post: Pick<Post, 'id' | 'gelada'>; onOpen?: () => void }) {
  const patch = usePostPatch(post.id);
  const [g, setG] = useState<PostGelada | null>(post.gelada ?? null);
  useEffect(() => setG(post.gelada ?? null), [post.gelada]);
  const [burst, setBurst] = useState(0);
  const [untagging, setUntagging] = useState(false);
  const busy = useRef(false);
  if (!g) return null;
  const gelada = g;

  function answered(n: GeladaRequest) {
    if (n.status === 'accepted') setBurst((k) => k + 1);
    const next = { ...gelada, requests: gelada.requests.map((x) => (x.id === n.id ? n : x)) };
    setG(next);
    patch({ gelada: next });
  }
  async function untag() {
    if (busy.current) return;
    busy.current = true;
    setUntagging(true);
    try {
      const p = await geladaApi.untag(post.id);
      setG(p.gelada ?? null);
      patch({ gelada: p.gelada ?? null });
    } catch (e) {
      Alert.alert('Não deu', geladaErrorText(e, 'Não consegui tirar a identificação. Tenta outra vez.'));
    } finally {
      busy.current = false;
      setUntagging(false);
    }
  }

  const title = postTitle(gelada.requests.map((r) => r.recipient), gelada.drink);
  return (
    <View style={st.wrap} accessibilityLabel={`Paga-me uma: ${title}`}>
      <LinearGradient colors={['#fffbeb', '#ffffff', '#fff1f2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Pressable onPress={onOpen} disabled={!onOpen} style={st.head} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={onOpen ? 'Abrir a publicação' : undefined}>
        <LinearGradient colors={gelada.drink.alcoholic && !gelada.drink.masked ? ['#fff7e6', '#fde68a'] : ['#f0f9ff', '#bae6fd']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.hero}>
          <View style={st.glow} />
          <View style={{ zIndex: 1 }}><DrinkArt slug={gelada.drink.slug} category={gelada.drink.category} size={84} /></View>
          <View style={st.shelf} />
        </LinearGradient>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.kicker}>{gelada.drink.alcoholic && !gelada.drink.masked ? 'PAGA-ME UMA' : 'PAGA-ME UM REFRESCO'}</Text>
          <Text style={st.title}>{title}</Text>
          {!gelada.drink.alcoholic && !gelada.drink.masked ? <Text style={st.drink} numberOfLines={1}>{drinkLabel(gelada.drink)} · sem álcool</Text> : null}
        </View>
      </Pressable>
      <View style={st.list}>
        {gelada.requests.map((r) => <Line key={r.id} r={r} onAnswered={answered} onUntag={() => void untag()} untagging={untagging} />)}
        {Array.from({ length: gelada.gone }, (_, i) => (
          <View key={`gone${i}`} style={[st.line, st.lineHead]}>
            <Icon name="user-circle" size={30} color={colors.zinc300} />
            <Text style={[st.lineName, { color: colors.zinc500, fontStyle: 'italic' }]}>Conta eliminada</Text>
          </View>
        ))}
      </View>
      <CheersPour n={burst} size={180} />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: 12, overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: '#fde68a', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hero: { width: 104, height: 112, borderRadius: 18, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8, overflow: 'hidden' },
  glow: { position: 'absolute', width: 96, height: 96, borderRadius: 48, top: -14, backgroundColor: 'rgba(255,255,255,0.55)' },
  shelf: { position: 'absolute', left: 14, right: 14, bottom: 8, height: 4, borderRadius: 2, backgroundColor: 'rgba(146,64,14,0.18)' },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: AMBER_INK },
  title: { marginTop: 2, fontSize: 19, lineHeight: 24, fontWeight: '800', color: colors.zinc900 },
  drink: { marginTop: 2, fontSize: 13, color: colors.zinc600 },
  list: { marginTop: 12, gap: 2 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.zinc200, paddingVertical: 8 },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineName: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  chip: { maxWidth: '60%', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 13, fontWeight: '700' },
  ask: { marginBottom: 8, fontSize: 14, color: colors.zinc700 },
  untag: { marginTop: 6, alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  untagText: { fontSize: 13, fontWeight: '600', color: colors.zinc600, textDecorationLine: 'underline' },
});

/**
 * O «Paga-me uma» na grelha do perfil: o mesmo do post em pequeno (a garrafa no fundo amarelo, «PAGA-ME UMA», a bebida e
 * quantos já pagaram), para a grelha mostrar o que o post mostra.
 */
export function GeladaGridTile({ gelada, size }: { gelada: PostGelada; size: number }) {
  const soft = !(gelada.drink.alcoholic && !gelada.drink.masked);
  const paid = gelada.requests.filter((r) => r.status === 'accepted').length;
  const total = gelada.requests.length;
  return (
    <LinearGradient colors={['#fffbeb', '#ffffff', '#fff1f2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { padding: 7, alignItems: 'center' }]}>
      <Text style={[st.kicker, { fontSize: 9, letterSpacing: 0.8 }]} numberOfLines={1}>{soft ? 'PAGA-ME UM REFRESCO' : 'PAGA-ME UMA'}</Text>
      <LinearGradient colors={soft ? ['#f0f9ff', '#bae6fd'] : ['#fff7e6', '#fde68a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.hero, { flex: 1, width: '100%', height: undefined, marginTop: 4, borderRadius: 12, paddingBottom: 4 }]}>
        <View style={[st.glow, { width: size * 0.6, height: size * 0.6, borderRadius: size * 0.3, top: -size * 0.1 }]} />
        <View style={{ zIndex: 1 }}><DrinkArt slug={gelada.drink.slug} category={gelada.drink.category} size={Math.round(size * 0.42)} /></View>
        <View style={[st.shelf, { width: '70%' }]} />
      </LinearGradient>
      <Text style={{ marginTop: 3, fontSize: 11, fontWeight: '800', color: colors.zinc900 }} numberOfLines={1}>{drinkLabel(gelada.drink)}</Text>
      <Text style={{ fontSize: 10, fontWeight: '700', color: paid ? '#15803d' : colors.zinc500 }} numberOfLines={1}>{paid ? `${paid} de ${total} ${paid === 1 ? 'pagou' : 'pagaram'} 🍻` : `${total} ${total === 1 ? 'pedido' : 'pedidos'}`}</Text>
    </LinearGradient>
  );
}
