import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { CheersPour } from '@/components/CheersPour';
import { InlineBadge } from '@/components/NameWithBadge';
import { MentionText } from '@/components/txillada/MentionText';
import { api, type Badged, type StoryComment } from '@/lib/api';
import { useReduceMotion } from '@/lib/reduceMotion';
import { FLOAT_GAP, type FloatColumn } from '@/lib/storyFrame';
import { commentCheersLabel } from '@/lib/txillada';
import { FLOAT_EVERY_MS, FLOAT_FIRST_MS, floatDone, floatName, floatOffsets, floatPool, floatText, floatWindow } from '@/lib/storyFloat';

/** O vidro escuro dos balões (o mesmo tom dos botões do visor). */
const GLASS = 'rgba(14,14,18,0.44)';
/** O vidro das ofertas de Txills na Txillada (a cor da marca). */
const GIFT_GLASS = 'rgba(214,51,79,0.88)';
const glassWeb = Platform.OS === 'web' ? ({ backdropFilter: 'blur(12px) saturate(150%)', WebkitBackdropFilter: 'blur(12px) saturate(150%)' } as object) : null;

/**
 * Os comentários do mimo a flutuar, à esquerda na metade de baixo do cartão (como nos diretos dos visores pro): cada um
 * num balão de vidro com a roda da foto de quem comentou. Entram de baixo com mola, sobem e desvanecem; no máximo `col.max`
 * à vista, a ciclar pelos últimos 10. `active` falso (mimo em pausa) pára o ciclo; `hidden` (a segurar) esconde-os.
 * A coluna (lib/storyFrame `floatColumn`) acaba acima da legenda e da assinatura. Tocar num balão abre os comentários;
 * dois toques brindam o comentário (só põem; já brindado, só os copos). A contagem nova vai para a lista dos comentários
 * em memória (`['story-comments', storyId]`), a mesma da folha.
 */
export function StoryFloatComments({ storyId, comments, col, active, hidden, onOpen }: { storyId: string; comments: readonly StoryComment[]; col: FloatColumn; active: boolean; hidden: boolean; onOpen: () => void }) {
  const reduce = useReduceMotion();
  const qc = useQueryClient();
  const setCheer = (id: string, cheers: number, cheered: boolean) =>
    qc.setQueryData<StoryComment[]>(['story-comments', storyId], (old) => old?.map((x) => (x.id === id ? { ...x, cheers: Math.max(0, cheers), cheered } : x)));
  function cheer(c: StoryComment) {
    if (c.cheered) return;
    const before = c.cheers ?? 0;
    setCheer(c.id, before + 1, true);
    api.cheerStoryComment(c.id).then(
      (r) => {
        // O pedido alterna: se já estava posto (noutro aparelho), tirou-o; volta a pôr.
        if (!r.cheered) return api.cheerStoryComment(c.id).then((r2) => setCheer(c.id, r2.cheers, !!r2.cheered));
        setCheer(c.id, r.cheers, true);
      },
      () => setCheer(c.id, before, false),
    ).catch(() => undefined);
  }
  const pool = floatPool(comments);
  const [tick, setTick] = useState(-1);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const done = floatDone(tick, pool.length, col.max);
  useEffect(() => {
    if (!active || done) return;
    const t = setTimeout(() => setTick((k) => k + 1), tick < 0 ? FLOAT_FIRST_MS : FLOAT_EVERY_MS);
    return () => clearTimeout(t);
  }, [active, done, tick]);
  const entries = floatWindow(tick, pool.length, col.max);
  const offsets = floatOffsets(entries, heights, 44, FLOAT_GAP);
  if (!entries.length) return null;
  return (
    <View
      style={[st.col, { left: col.left, width: col.width, bottom: col.bottom, height: col.height }, hidden && st.hidden]}
      pointerEvents={hidden ? 'none' : 'box-none'}
    >
      {entries.map((e) => {
        const c = pool[e.index];
        if (!c) return null;
        return (
          <FloatBubble
            key={e.key}
            c={c}
            y={offsets[e.key] ?? 0}
            age={e.age}
            leaving={e.leaving}
            reduce={reduce}
            onPress={onOpen}
            cheers={c.cheers ?? 0}
            onDoubleTap={() => cheer(c)}
            onHeight={(h) => setHeights((old) => (old[e.key] === h ? old : { ...old, [e.key]: h }))}
          />
        );
      })}
    </View>
  );
}

/** O que um balão precisa de um comentário (o dos mimos e o da Txillada). */
export type FloatComment = { author: { username: string; displayName: string; hasAvatar: boolean } & Badged; body: string };

/**
 * Dois toques dentro disto contam como um duplo toque (o toque simples espera este tempo antes de abrir: os comentários
 * do mimo, ou o menu do comentário na Txillada). O padrão do projeto: ~250 ms, curto o bastante para não parecer lento.
 */
export const DOUBLE_MS = 250;

/**
 * Um balão de vidro com a roda da foto de quem comentou (também os da Txillada, components/txillada/LiveFloatComments).
 * `label`: o que o leitor de ecrã diz ao tocar; `onLongPress`: o toque longo (na Txillada, o mesmo menu do toque simples).
 * `onDoubleTap`: dois toques brindam (os copos saltam do balão e o telemóvel vibra). `cheers`: a pastilha «🍻 N» ao lado,
 * que salta quando a contagem sobe; com a contagem a subir por outra pessoa (a sala da Txillada) também saltam os copos.
 */
/** `gift`: a linha destacada «@x ofereceu N Txills» da Txillada (0167): o vidro na cor da marca, com o presente. */
/** `onMention`: os @nomes do texto ficam a negrito e tocáveis (a Txillada: abrem o perfil). */
export function FloatBubble({ c, y, age, leaving, reduce, onPress, onLongPress, onDoubleTap, cheers = 0, onHeight, label = 'Abrir os comentários', gift = false, onMention }: { c: FloatComment; y: number; age: number; leaving: boolean; reduce: boolean; onPress?: () => void; onLongPress?: () => void; onDoubleTap?: () => void; cheers?: number; onHeight: (h: number) => void; label?: string; gift?: boolean; onMention?: (username: string) => void }) {
  const ty = useSharedValue(reduce ? -y : 22);
  const scale = useSharedValue(reduce ? 1 : 0.9);
  const op = useSharedValue(0);
  // Os mais velhos (mais acima) ficam um pouco mais apagados; o que sai desvanece a subir.
  const target = leaving ? 0 : age === 0 ? 1 : age === 1 ? 0.9 : 0.72;
  useEffect(() => {
    op.value = withTiming(target, { duration: leaving ? 520 : 320, easing: Easing.out(Easing.quad) });
    if (reduce) { ty.value = -y; scale.value = 1; return; }
    ty.value = withSpring(-y, { damping: 17, stiffness: 120, mass: 0.9 });
    scale.value = withSpring(1, { damping: 14, stiffness: 160 });
  }, [y, target, leaving, reduce, op, ty, scale]);
  const anim = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateY: ty.value }, { scale: scale.value }] }));

  // O brinde: os copos (CheersPour pequeno) por cima do balão e a pastilha a saltar.
  const [burst, setBurst] = useState(0);
  const pill = useSharedValue(1);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ scale: pill.value }] }));
  const seen = useRef(cheers);
  const mineAt = useRef(0);
  useEffect(() => {
    const before = seen.current;
    seen.current = cheers;
    if (cheers <= before || reduce) return;
    pill.value = withSequence(withTiming(1.35, { duration: 110 }), withSpring(1, { damping: 7, stiffness: 260 }));
    // Os copos do meu duplo toque já saíram; os de outra pessoa saem agora.
    if (Date.now() - mineAt.current > 1500) setBurst((n) => n + 1);
  }, [cheers, reduce, pill]);
  const lastTap = useRef(0);
  const single = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (single.current) clearTimeout(single.current); }, []);
  function press() {
    if (!onDoubleTap) return onPress?.();
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_MS) {
      lastTap.current = 0;
      if (single.current) clearTimeout(single.current);
      single.current = null;
      mineAt.current = now;
      if (!reduce) setBurst((n) => n + 1);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      onDoubleTap();
      return;
    }
    lastTap.current = now;
    if (onPress) single.current = setTimeout(() => { single.current = null; onPress(); }, DOUBLE_MS);
  }
  const pillText = commentCheersLabel(cheers);
  const name = floatName(c.author.username);
  const text = floatText(c.body);
  return (
    <Animated.View style={[st.bubbleWrap, anim]} pointerEvents={leaving ? 'none' : 'box-none'} onLayout={(ev) => onHeight(Math.round(ev.nativeEvent.layout.height))}>
      <Pressable
        onPress={onPress || onDoubleTap ? press : undefined}
        onLongPress={onLongPress}
        delayLongPress={400}
        style={st.row}
        accessibilityRole="button"
        accessibilityLabel={`Comentário de ${c.author.username}: ${text}${cheers ? `. ${cheers} ${cheers === 1 ? 'brinde' : 'brindes'}` : ''}${label ? `. ${label}` : ''}`}
        accessibilityHint={onDoubleTap ? 'Dois toques para brindar' : undefined}
        accessibilityActions={onDoubleTap ? [{ name: 'cheer', label: 'Brindar' }] : undefined}
        onAccessibilityAction={onDoubleTap ? (e) => { if (e.nativeEvent.actionName === 'cheer') onDoubleTap(); } : undefined}
      >
        <View style={st.ring}>
          <Avatar name={c.author.displayName} username={c.author.hasAvatar ? c.author.username : undefined} size={26} />
        </View>
        <View style={[st.glass, glassWeb, gift && st.giftGlass]}>
          <Text style={[st.text, gift && st.giftText]} numberOfLines={2}>
            <Text style={st.name}>{name}</Text>
            {/* Contas verificadas com o selo em todo o lado, também nos balões. */}
            {c.author.verified ? <InlineBadge who={c.author} fontSize={14} /> : null}
            {'  '}
            {onMention ? <MentionText text={text} onMention={onMention} /> : text}
          </Text>
        </View>
        {/* O rabinho do balão, no canto de baixo à esquerda, virado para a foto de quem comentou. */}
        <Svg width={7} height={11} viewBox="0 0 7 11" style={st.tail} pointerEvents="none">
          <Path d="M7 0 C7 5 5 9 0 11 L7 11 Z" fill={gift ? GIFT_GLASS : GLASS} />
        </Svg>
        {pillText ? (
          <Animated.View style={[st.pill, glassWeb, pillStyle]} pointerEvents="none">
            <Text style={st.pillText}>{pillText}</Text>
          </Animated.View>
        ) : null}
        <View style={st.burst} pointerEvents="none"><CheersPour n={burst} size={72} /></View>
      </Pressable>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  col: { position: 'absolute', zIndex: 4, elevation: 4 },
  hidden: { opacity: 0 },
  bubbleWrap: { position: 'absolute', left: 0, bottom: 0, maxWidth: '100%', transformOrigin: 'left bottom' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  ring: { borderRadius: 999, padding: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.95)', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  glass: { flexShrink: 1, minWidth: 0, borderRadius: 16, borderBottomLeftRadius: 4, backgroundColor: GLASS, paddingHorizontal: 11, paddingVertical: 7 },
  // A roda tem 31 px (26 + 1 de folga + 1,5 de anel de cada lado) e o espaço 7: o rabinho encosta ao vidro (meio px por baixo dele).
  tail: { position: 'absolute', left: 31.5, bottom: 0 },
  name: { fontWeight: '800', color: '#fff', letterSpacing: -0.1 },
  giftGlass: { backgroundColor: GIFT_GLASS, borderWidth: 1, borderColor: 'rgba(255,154,91,0.75)' },
  giftText: { color: '#fff', fontWeight: '700' },
  text: { color: 'rgba(255,255,255,0.94)', fontSize: 13.5, lineHeight: 18, fontWeight: '500' },
  // «🍻 N» encostada ao fim do balão, em baixo (o mesmo vidro).
  pill: { alignSelf: 'flex-end', flexShrink: 0, borderRadius: 999, backgroundColor: GLASS, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 2 },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  // Os copos saem do meio do balão (sem a roda da foto).
  burst: { position: 'absolute', left: 38, right: 0, top: -24, bottom: -24 },
});
