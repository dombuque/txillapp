import { useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { colors } from '@/lib/theme';
import { joined, place, ticksFor } from '@/lib/chatLayout';
import { Bubble, ChatStamp, TypingBubble, type Msg } from './ChatBubbles';
import { Pulse } from './ChatParts';

/** Duas mensagens seguidas da mesma pessoa, no mesmo dia, com ≤ 3 min e sem separador de hora: juntam-se (ver lib/chatLayout). */
export { joined };

/**
 * A lista de mensagens da conversa: separadores de hora (> 15 min ou dia novo), bolhas agrupadas com o avatar da outra pessoa
 * na última de cada grupo, "a escrever…", "Visto"/"Entregue" só na minha última, citações que saltam para a mensagem original
 * e o botão para ir ao fim. Recebe as mensagens da mais recente para a mais antiga (lista invertida).
 */
export function ChatList({
  items, group = false, loading, hasNext, fetchNext, fetchingNext, typing, seenId, emptyText, top, peerName, peerHandle, peerHasAvatar = true, meHandle, onMenu, onCheer, onOpenOnce, onStopLive, onRetry,
}: {
  items: Msg[]; group?: boolean; loading: boolean; hasNext: boolean; fetchNext: () => Promise<unknown> | void; fetchingNext: boolean; typing?: boolean;
  seenId: string | null; emptyText: string; top?: ReactNode; peerName?: string; peerHandle?: string;
  /** Nas conversas diretas: o outro lado tem foto de perfil (se não, o avatar ao lado das bolhas mostra as iniciais). */
  peerHasAvatar?: boolean;
  meHandle?: string;
  onMenu: (m: Msg) => void; onCheer: (m: Msg) => void; onOpenOnce: (m: Msg) => void; onStopLive: (m: Msg) => void; onRetry: (m: Msg) => void;
}) {
  const list = useRef<FlatList<Msg>>(null);
  const [away, setAway] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const ticks = useMemo(() => ticksFor(items, seenId, group), [items, seenId, group]);
  const peerWho = group ? null : { name: peerName ?? peerHandle ?? '', username: peerHasAvatar ? peerHandle : undefined };

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
    <View style={{ flex: 1 }}>
      {loading ? (
        <Pulse style={{ paddingHorizontal: 16, paddingTop: 16, gap: 12 }}>
          {[60, 40, 70, 48].map((w, i) => <View key={i} style={{ height: 40, width: `${w}%`, borderRadius: 20, backgroundColor: colors.zinc100, alignSelf: i % 2 ? 'flex-end' : 'flex-start' }} />)}
        </Pulse>
      ) : (
        <FlatList
          ref={list}
          inverted
          data={items}
          extraData={`${flashId}|${seenId}`}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 8, flexGrow: 1, justifyContent: 'flex-end' }}
          onScroll={(e) => setAway(e.nativeEvent.contentOffset.y > 320)}
          scrollEventThrottle={64}
          onScrollToIndexFailed={(info) => list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })}
          renderItem={({ item, index }) => {
            // Lista invertida: o "anterior" no tempo é o índice seguinte.
            const older = items[index + 1];
            const newer = items[index - 1];
            const p = place(older, item, newer, group);
            return (
              <View>
                {p.stamp && <ChatStamp iso={item.at} />}
                <Bubble
                  m={item}
                  group={group}
                  flash={flashId === item.id}
                  prevSame={!p.first}
                  nextSame={!p.last}
                  first={p.first}
                  last={p.last}
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
          ListEmptyComponent={<Text style={st.empty}>{emptyText}</Text>}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (hasNext && !fetchingNext) void fetchNext(); }}
        />
      )}
      {away && !loading && (
        <Pressable onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} style={st.down} accessibilityRole="button" accessibilityLabel="Ir para o fim">
          <View style={{ transform: [{ rotate: '90deg' }] }}><Icon name="chevron-right" size={16} color={colors.zinc800} /></View>
        </Pressable>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  older: { alignSelf: 'center', marginVertical: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 6 },
  olderText: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },
  empty: { paddingVertical: 64, textAlign: 'center', color: colors.zinc500, transform: [{ scaleY: -1 }] },
  down: { position: 'absolute', bottom: 12, alignSelf: 'center', left: '50%', marginLeft: -20, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.zinc100, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.2)' },
});
