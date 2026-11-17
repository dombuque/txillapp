import { useEffect, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { InlineBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { CallIcon } from '@/components/calls/CallIcons';
import { LiveFloatComments } from '@/components/txillada/LiveFloatComments';
import { MentionText } from '@/components/txillada/MentionText';
import { colors } from '@/lib/theme';
import { commentCheersLabel, type TxilladaComment } from '@/lib/txillada';
import { atEnd, keepOffset, nearTop, newLabel, newSince } from '@/lib/txilladaChat';

const GLASS = 'rgba(14,14,18,0.5)';
const GIFT_GLASS = 'rgba(214,51,79,0.88)';
const glassWeb = Platform.OS === 'web' ? ({ backdropFilter: 'blur(12px) saturate(150%)', WebkitBackdropFilter: 'blur(12px) saturate(150%)' } as object) : null;
/** Em cima a lista desvanece (só no site: a máscara do CSS). */
const fadeTop = Platform.OS === 'web' ? ({ maskImage: 'linear-gradient(to bottom, transparent 0, #000 56px)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 56px)' } as object) : null;
/** Parado no fim da lista, sem tocar, volta aos balões a flutuar ao fim disto. */
const IDLE_MS = 6000;

type Props = {
  comments: readonly TxilladaComment[];
  /** Onde fica a conversa (a contar de baixo), a largura e a altura dos balões a flutuar e da lista a rolar. */
  bottom: number;
  width: number;
  height: number;
  listHeight: number;
  onOpen?: (c: TxilladaComment) => void;
  onCheer?: (c: TxilladaComment) => void;
  onMention?: (username: string) => void;
  /** O fixado (não flutua: está na pílula). */
  hidden?: string | null;
  /** Há mais antigos na API, a carregar, e pedir os antigos. */
  more: boolean;
  busy: boolean;
  onLoadOlder: () => void;
};

/**
 * A conversa por cima do vídeo. Por omissão, os balões a flutuar (components/txillada/LiveFloatComments). Tocar ou
 * arrastar na zona dos comentários abre a lista a rolar: todos os desta Txillada desde que entrei (e, ao chegar ao topo,
 * os mais antigos da API). Enquanto leio para trás os novos não me puxam para baixo: aparece «N comentários novos», que
 * volta ao fim. Tocar num comentário abre o menu dele (a lista distingue o toque do arrasto); o @ abre o perfil. Parado no
 * fim, sem tocar, volta aos balões.
 */
export function LiveComments(p: Props) {
  const [reading, setReading] = useState(false);
  const [pull, setPull] = useState(0);
  const start = (dy: number) => { setPull(Math.max(0, Math.round(dy))); setReading(true); };
  const zone = useRef(PanResponder.create({
    // Os toques nos balões são deles (o menu, os dois toques para brindar); um toque fora deles abre a lista.
    onStartShouldSetPanResponder: () => true,
    // Arrastar na vertical, também por cima de um balão, abre a lista.
    onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
    onPanResponderRelease: (_e, g) => start(g.dy),
    onPanResponderTerminationRequest: () => true,
  })).current;
  if (!p.comments.length) return null;
  if (reading) return <ReadingList {...p} pull={pull} onDone={() => setReading(false)} />;
  return (
    <View style={[st.zone, { bottom: p.bottom, width: p.width + 12, height: p.height }]} {...zone.panHandlers} testID="txillada-comments-zone" accessibilityHint="Arrasta para ler os comentários anteriores">
      <LiveFloatComments comments={p.comments} bottom={0} left={12} width={p.width} height={p.height} onOpen={p.onOpen} onCheer={p.onCheer} hidden={p.hidden} onMention={p.onMention} />
    </View>
  );
}

function ReadingList({ comments, bottom, width, listHeight, onOpen, onMention, more, busy, onLoadOlder, pull, onDone }: Props & { pull: number; onDone: () => void }) {
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const y = useRef(0);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const [end, setEnd] = useState(true);
  /** O último comentário que vi no fim da lista (os que vierem depois contam como novos). */
  const [seen, setSeen] = useState<string | null>(comments.at(-1)?.id ?? null);
  const first = useRef(true);
  const firstId = useRef(comments[0]?.id);
  const before = useRef<{ y: number; h: number } | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const lastId = comments.at(-1)?.id ?? null;
  const ids = comments.map((c) => c.id);
  const fresh = end ? 0 : newSince(ids, seen);

  const arm = () => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => { if (atEnd(y.current, viewH.current, contentH.current)) doneRef.current(); }, IDLE_MS);
  };
  useEffect(() => { arm(); return () => { if (idle.current) clearTimeout(idle.current); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // No fim, os novos seguem (e contam como vistos); a ler para trás, ficam à espera.
  useEffect(() => {
    if (end) {
      setSeen(lastId);
      requestAnimationFrame(() => ref.current?.scrollToEnd({ animated: true }));
    }
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const n = e.nativeEvent;
    y.current = n.contentOffset.y;
    viewH.current = n.layoutMeasurement.height;
    contentH.current = n.contentSize.height;
    const isEnd = atEnd(y.current, viewH.current, contentH.current);
    if (isEnd !== end) setEnd(isEnd);
    if (isEnd) setSeen(lastId);
    if (nearTop(y.current) && more && !busy) {
      before.current = { y: y.current, h: contentH.current };
      onLoadOlder();
    }
    arm();
  };
  const onSize = (_w: number, h: number) => {
    const prev = contentH.current;
    contentH.current = h;
    if (first.current) {
      first.current = false;
      // Abre no fim; se se abriu a arrastar para baixo, já um bocadinho para trás.
      ref.current?.scrollToEnd({ animated: false });
      if (pull > 0) setTimeout(() => ref.current?.scrollTo({ y: Math.max(0, h - viewH.current - pull), animated: true }), 30);
      return;
    }
    // Chegaram os antigos por cima: o que estava à vista não salta.
    if (comments[0]?.id !== firstId.current) {
      firstId.current = comments[0]?.id;
      const b = before.current ?? { y: y.current, h: prev };
      before.current = null;
      ref.current?.scrollTo({ y: keepOffset(b.y, b.h, h), animated: false });
    }
  };
  const toEnd = () => {
    setSeen(lastId);
    setEnd(true);
    ref.current?.scrollToEnd({ animated: true });
  };

  return (
    <View style={[st.list, { bottom, width, height: listHeight }]} testID="txillada-comments-list">
      <ScrollView
        ref={ref}
        style={[StyleSheet.absoluteFill, fadeTop]}
        contentContainerStyle={st.content}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onContentSizeChange={onSize}
        onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
        onTouchStart={arm}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel="Comentários da Txillada"
      >
        {busy ? <View style={st.loading}><ActivityIndicator color="#fff" /></View> : more ? <View style={{ height: 28 }} /> : <Text style={st.start}>Início da conversa</Text>}
        {comments.map((c) => <Row key={c.id} c={c} onOpen={onOpen} onMention={onMention} />)}
      </ScrollView>
      {fresh > 0 ? (
        <Pressable onPress={toEnd} style={({ pressed }) => [st.fresh, pressed && { opacity: 0.85 }]} accessibilityRole="button" testID="txillada-new-comments">
          <CallIcon name="chevron-down" size={15} color="#fff" />
          <Text style={st.freshText}>{newLabel(fresh)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Row({ c, onOpen, onMention }: { c: TxilladaComment; onOpen?: (c: TxilladaComment) => void; onMention?: (u: string) => void }) {
  const gift = !!c.gift;
  const pill = commentCheersLabel(c.cheers ?? 0);
  const open = onOpen && !gift ? () => onOpen(c) : undefined;
  return (
    <Pressable onPress={open} onLongPress={open} delayLongPress={400} disabled={!open} style={st.row} accessibilityRole={open ? 'button' : undefined} accessibilityLabel={`Comentário de ${c.author.username}: ${c.body}`}>
      <View style={st.ring}>
        <Avatar name={c.author.displayName} username={c.author.avatarUrl ? c.author.username : undefined} size={26} />
      </View>
      <View style={[st.glass, glassWeb, gift && st.giftGlass]}>
        <Text style={[st.text, gift && st.giftText]}>
          <Text style={st.name}>{c.author.username}</Text>
          {/* Contas verificadas com o selo em todo o lado, também na lista. */}
          {c.author.verified ? <InlineBadge who={c.author} fontSize={14} /> : null}
          {'  '}
          {onMention && !gift ? <MentionText text={c.body} onMention={onMention} /> : c.body}
        </Text>
      </View>
      {pill ? <View style={[st.pill, glassWeb]}><Text style={st.pillText}>{pill}</Text></View> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  zone: { position: 'absolute', left: 0, zIndex: 4, elevation: 4 },
  list: { position: 'absolute', left: 12, zIndex: 4, elevation: 4 },
  content: { flexGrow: 1, justifyContent: 'flex-end', gap: 8, paddingTop: 8, paddingBottom: 4 },
  loading: { height: 28, alignItems: 'center', justifyContent: 'center' },
  start: { alignSelf: 'flex-start', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, maxWidth: '100%' },
  ring: { borderRadius: 999, padding: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.95)' },
  glass: { flexShrink: 1, minWidth: 0, borderRadius: 16, borderBottomLeftRadius: 4, backgroundColor: GLASS, paddingHorizontal: 11, paddingVertical: 7 },
  giftGlass: { backgroundColor: GIFT_GLASS, borderWidth: 1, borderColor: 'rgba(255,154,91,0.75)' },
  giftText: { color: '#fff', fontWeight: '700' },
  name: { fontWeight: '800', color: '#fff', letterSpacing: -0.1 },
  text: { color: 'rgba(255,255,255,0.94)', fontSize: 13.5, lineHeight: 18, fontWeight: '500' },
  pill: { alignSelf: 'flex-end', flexShrink: 0, borderRadius: 999, backgroundColor: GLASS, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 2 },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  fresh: { position: 'absolute', bottom: 6, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.brand, boxShadow: '0 4px 14px rgba(0,0,0,0.3)' } as object,
  freshText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
