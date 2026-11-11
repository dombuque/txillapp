import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { ticksFor } from '@/lib/chatLayout';
import { chatTimeline, firstUnreadId } from '@/lib/chatTimeline';
import { colors } from '@/lib/theme';
import { Bubble, TypingBubble, type Msg } from './ChatBubbles';
import { Pulse } from './ChatParts';

/** Fundo da área das mensagens (cinzento muito claro; o cabeçalho e a barra de escrever ficam brancos). */
export const CHAT_BG = '#f5f6f8';

/**
 * A lista de mensagens da conversa: separadores em pílula (dia novo ou > 15 min no mesmo dia), "Mensagens novas", bolhas
 * agrupadas com o avatar da outra pessoa na última de cada grupo, a hora e os vistos (✓ entregue, ✓✓ visto) por baixo da
 * última bolha de cada grupo meu, "a escrever…", citações que saltam para a mensagem original e o botão para ir ao fim.
 * Recebe as mensagens da mais recente para a mais antiga (lista invertida); a linha do tempo (src/lib/chatTimeline.ts,
 * a única que decide separadores e agrupamento) faz-se por ordem de tempo.
 */
export function ChatList({
  items, group = false, loading, hasNext, fetchNext, fetchingNext, typing, seenId, emptyText, emptyTitle, emptyArt, unread = 0, top, peerName, peerHandle, peerAvatar, meHandle,
  onRaised, onMenu, onCheer, onOpenOnce, onStopLive, onRetry, onReply,
}: {
  items: Msg[]; group?: boolean; loading: boolean; hasNext: boolean; fetchNext: () => Promise<unknown> | void; fetchingNext: boolean; typing?: boolean;
  seenId: string | null; emptyText: string; emptyTitle?: string; emptyArt?: ReactNode;
  /** Por ler quando a conversa abriu (da lista de conversas): põe o "Mensagens novas" antes da primeira. */
  unread?: number;
  top?: ReactNode; peerName?: string; peerHandle?: string;
  /** `username` da outra pessoa quando tem foto (avatar ao lado das bolhas e do "a escrever…"; sem foto, as iniciais). */
  peerAvatar?: string;
  meHandle?: string;
  /** Há mensagens escondidas por baixo do cabeçalho (para a sombra dele). */
  onRaised?: (raised: boolean) => void;
  onMenu: (m: Msg) => void; onCheer: (m: Msg) => void; onOpenOnce: (m: Msg) => void; onStopLive: (m: Msg) => void; onRetry: (m: Msg) => void;
  /** Deslizar uma bolha para a direita responde-lhe (o mesmo que "Responder" no menu). */
  onReply?: (m: Msg) => void;
}) {
  const list = useRef<FlatList<Msg>>(null);
  const [away, setAway] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Vistos das minhas (lib/chatLayout): ✓✓ na `seenId` (a minha última já enviada, quando a outra pessoa a leu) e nas
  // anteriores, e nas que a outra pessoa respondeu depois; ✓ nas outras. Nos TxillGroups não há vistos.
  const ticks = useMemo(() => ticksFor(items, seenId, group), [items, seenId, group]);
  const peerHasAvatar = !!peerAvatar;
  const peerWho = group ? null : { name: peerName ?? peerHandle ?? '', username: peerAvatar };

  // Ordem de tempo (a mais antiga primeiro) para a linha do tempo; a lista é invertida.
  const chrono = useMemo(() => [...items].reverse(), [items]);
  // O "Mensagens novas" fica preso à mensagem onde estava ao abrir (as que chegam depois não o mudam de sítio).
  const [newFrom, setNewFrom] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (newFrom === undefined && !loading && chrono.length > 0) setNewFrom(firstUnreadId(chrono, unread));
  }, [newFrom, loading, chrono, unread]);
  const rows = useMemo(() => chatTimeline(chrono, { group, newFrom }), [chrono, group, newFrom]);

  // Mensagens que chegaram enquanto estavas lá em cima (o número no botão de ir ao fim).
  const awayFrom = useRef<string | null>(null);
  const cut = away && awayFrom.current ? items.findIndex((m) => m.id === awayFrom.current) : -1;
  const freshCount = cut > 0 ? items.slice(0, cut).filter((m) => !m.fromMe).length : 0;

  // Sombra do cabeçalho: há mensagens acima do que está à vista (lista invertida: o fim do deslize é o topo do ecrã).
  const geo = useRef({ y: 0, h: 0, c: 0 });
  const raisedRef = useRef<boolean | null>(null); // null: ainda não disse nada ao ecrã (volta a dizer ao remontar)
  function updateRaised(p: Partial<{ y: number; h: number; c: number }>) {
    Object.assign(geo.current, p);
    const { y, h, c } = geo.current;
    const r = h > 0 && c - (y + h) > 4;
    if (r !== raisedRef.current) {
      raisedRef.current = r;
      onRaised?.(r);
    }
  }
  function onScroll(e: { nativeEvent: NativeScrollEvent }) {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const far = contentOffset.y > 320;
    if (far !== away) {
      awayFrom.current = far ? itemsRef.current[0]?.id ?? null : null;
      setAway(far);
    }
    updateRaised({ y: contentOffset.y, h: layoutMeasurement.height, c: contentSize.height });
  }

  // Tocar na citação de uma resposta leva à mensagem original (carrega mais antigas se for preciso) e destaca-a um instante.
  async function jumpTo(id: string, tries = 0) {
    const i = itemsRef.current.findIndex((x) => x.id === id);
    if (i >= 0) {
      list.current?.scrollToIndex({ index: i, viewPosition: 0.5, animated: true });
      setFlashId(id);
      setTimeout(() => setFlashId((c) => (c === id ? null : c)), 1800);
      return;
    }
    if (!hasNext || tries >= 8) return;
    await fetchNext();
    setTimeout(() => void jumpTo(id, tries + 1), 120);
  }

  return (
    <View style={{ flex: 1, backgroundColor: CHAT_BG }}>
      {loading ? (
        <Pulse style={{ paddingHorizontal: 16, paddingTop: 16, gap: 10 }}>
          {[60, 40, 70, 48].map((w, i) => <View key={i} style={{ height: 40, width: `${w}%`, borderRadius: 20, backgroundColor: '#e8e9ed', alignSelf: i % 2 ? 'flex-end' : 'flex-start' }} />)}
        </Pulse>
      ) : (
        <FlatList
          ref={list}
          inverted
          data={items}
          extraData={`${flashId}|${seenId}|${newFrom}|${rows.length}`}
          keyExtractor={(m) => m.id}
          // Invertida: 'flex-start' é o fundo do ecrã; poucas mensagens ficam junto à barra de escrever, como nas boas apps de mensagens.
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 10, paddingTop: 8, flexGrow: 1, justifyContent: 'flex-start' }}
          onScroll={onScroll}
          onLayout={(e) => updateRaised({ h: e.nativeEvent.layout.height })}
          onContentSizeChange={(_, c) => updateRaised({ c })}
          scrollEventThrottle={64}
          onScrollToIndexFailed={(info) => list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })}
          renderItem={({ item, index }) => {
            // Lista invertida: a linha do tempo está por ordem de tempo.
            const row = rows[items.length - 1 - index];
            return (
              <View>
                {row?.newMark ? <NewMark /> : null}
                {row?.divider ? <TimeDivider label={row.divider} /> : null}
                <Bubble
                  m={item}
                  group={group}
                  flash={flashId === item.id}
                  prevSame={!!row?.prevSame}
                  nextSame={!!row?.nextSame}
                  ticks={ticks.get(item.id) ?? null}
                  peerName={peerName}
                  peerHandle={peerHandle}
                  peerHasAvatar={peerHasAvatar}
                  meHandle={meHandle}
                  onMenu={onMenu}
                  onCheer={onCheer}
                  onOpenOnce={onOpenOnce}
                  onStopLive={onStopLive}
                  onRetry={onRetry}
                  onReply={onReply}
                  onJump={(id) => void jumpTo(id)}
                />
              </View>
            );
          }}
          ListHeaderComponent={typing ? <TypingBubble avatar={peerWho} /> : undefined}
          ListFooterComponent={
            <View>
              {hasNext && (
                <Pressable onPress={() => void fetchNext()} disabled={fetchingNext} style={st.older} accessibilityRole="button">
                  {fetchingNext ? <ActivityIndicator color={colors.zinc500} /> : <Text style={st.olderText}>Ver mensagens anteriores</Text>}
                </Pressable>
              )}
              {top}
            </View>
          }
          ListEmptyComponent={
            <View style={st.empty}>
              {emptyArt}
              {emptyTitle ? <Text style={st.emptyTitle} numberOfLines={2}>{emptyTitle}</Text> : null}
              <Text style={st.emptyText}>{emptyText}</Text>
            </View>
          }
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (hasNext && !fetchingNext) void fetchNext(); }}
        />
      )}
      {away && !loading && (
        <Pressable
          onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          style={({ pressed }) => [st.down, pressed && { backgroundColor: colors.zinc100 }]}
          accessibilityRole="button"
          accessibilityLabel={freshCount ? `Ir para o fim, ${freshCount} ${freshCount === 1 ? 'mensagem nova' : 'mensagens novas'}` : 'Ir para o fim'}
        >
          <View style={{ transform: [{ rotate: '90deg' }] }}><Icon name="chevron-right" size={20} color={colors.zinc800} strokeWidth={2.2} /></View>
          {freshCount > 0 ? <View style={st.badge}><Text style={st.badgeText}>{freshCount > 99 ? '99+' : freshCount}</Text></View> : null}
        </Pressable>
      )}
    </View>
  );
}

/** Separador central: uma pílula pequena com o dia ("Hoje, 10 nov") ou, num salto grande, o dia e a hora ("Hoje, 11:40"). */
function TimeDivider({ label }: { label: string }) {
  return (
    <View style={st.divider} accessibilityRole="header">
      <Text style={st.dividerText}>{label}</Text>
    </View>
  );
}

/** "Mensagens novas": uma linha fina da marca com o texto ao meio. */
function NewMark() {
  return (
    <View style={st.newMark} accessibilityRole="header" accessibilityLabel="Mensagens novas">
      <View style={st.newLine} />
      <Text style={st.newText}>Mensagens novas</Text>
      <View style={st.newLine} />
    </View>
  );
}

const st = StyleSheet.create({
  older: { alignSelf: 'center', marginVertical: 8, borderRadius: 999, backgroundColor: colors.white, paddingHorizontal: 16, minHeight: 36, justifyContent: 'center' },
  olderText: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },
  // Pílula branca no fundo cinzento (zinc500 em branco passa o AA; em #ebedf0 ficava abaixo).
  divider: { alignSelf: 'center', marginTop: 16, marginBottom: 6, borderRadius: 999, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 4, boxShadow: '0 1px 1px rgba(24,24,27,0.04)' },
  dividerText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.zinc500 },
  newMark: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 2, paddingHorizontal: 8 },
  newLine: { flex: 1, height: 1, backgroundColor: 'rgba(214,51,79,0.28)' },
  newText: { fontSize: 12, fontWeight: '700', color: colors.brand },
  // Lista invertida: o vazio também vem invertido; desfaz-se aqui.
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 48, gap: 6, transform: [{ scaleY: -1 }] },
  emptyTitle: { marginTop: 10, fontSize: 18, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  emptyText: { fontSize: 15, lineHeight: 21, color: colors.zinc600, textAlign: 'center' },
  down: { position: 'absolute', bottom: 12, right: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(24,24,27,0.08), 0 4px 14px rgba(24,24,27,0.16)' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
