import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { what } from '@/app/(tabs)/messages';
import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { useChatHiding } from '@/components/ChatHide';
import { Pulse } from '@/components/ChatParts';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { GroupCover } from '@/components/groups/GroupParts';
import { groupCardData } from '@/components/groups/GroupCard';
import { api } from '@/lib/api';
import type { TxillGroupSummary } from '@/lib/api.groups';
import { HIDDEN_EMPTY, HIDDEN_NOTE, HIDDEN_QUERY_KEY, HIDDEN_TITLE, hiddenRows } from '@/lib/chatHidden';
import { emptyPreview } from '@/lib/chatTemporary';
import { groupSenderPrefix, listTime, rowLabel, unreadBadge } from '@/lib/inboxRow';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

/**
 * O sítio do bloqueio extra das escondidas (impressão digital / PIN): ainda não existe (precisa de um pacote nativo novo,
 * lib/chatHidden). Quando existir, este portão pede-o antes de mostrar a lista; por agora deixa passar.
 */
function HiddenLock({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * «Conversas ocultas» (Mensagens → ⋯): as conversas a dois e os TxillGroups que escondi. Tocar abre a conversa;
 * «Mostrar» volta a pô-la na lista de Mensagens. Mensagens novas não as trazem de volta (o servidor, 0160).
 */
export default function HiddenChats() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const hiding = useChatHiding();
  const q = useQuery({ queryKey: HIDDEN_QUERY_KEY, queryFn: api.chatHiddenList, refetchInterval: 60_000 });
  const rows = hiddenRows(q.data);

  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <View style={st.header}>
        <BackButton fallback="/messages" style={st.back} />
        <Text style={st.title} accessibilityRole="header" numberOfLines={1}>{HIDDEN_TITLE()}</Text>
        <View style={st.back} />
      </View>
      <HiddenLock>
        <FlatList
          data={rows}
          keyExtractor={(r) => (r.kind === 'chat' ? `d:${r.c.username}` : `g:${r.g.id}`)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 16) + 8 }}
          ListHeaderComponent={
            <View style={st.note}>
              <Icon name="eye-off" size={18} color={colors.zinc500} />
              <Text style={st.noteText}>{HIDDEN_NOTE()}</Text>
            </View>
          }
          renderItem={({ item: r }) => {
            if (r.kind === 'chat') {
              const c = r.c;
              const sub = emptyPreview(c.lastMessage) ?? what(c.lastMessage);
              return (
                <HiddenRow
                  photo={<Avatar name={c.displayName} username={c.hasAvatar ? c.username : undefined} size={52} />}
                  name={<NameWithBadge name={c.displayName} who={c} style={[st.name, c.unread > 0 && { fontWeight: '800' }]} containerStyle={{ flexShrink: 1 }} />}
                  label={c.displayName}
                  sub={sub}
                  at={c.lastMessage.at}
                  unread={c.unread}
                  marked={!!c.marked}
                  onOpen={() => router.push(`/messages/${c.username}` as never)}
                  onShow={() => hiding.unhide({ username: c.username })}
                />
              );
            }
            const g = r.g as unknown as TxillGroupSummary;
            const sub = emptyPreview(g.lastMessage, { members: g.members }) ?? `${groupSenderPrefix(g.lastMessage)}${what(g.lastMessage, true)}`;
            return (
              <HiddenRow
                photo={<GroupCover url={g.avatarUrl} kind={groupCardData(g).kind} size={52} radius={26} />}
                name={<Text style={[st.name, g.unread > 0 && { fontWeight: '800' }]} numberOfLines={1}>{g.name}</Text>}
                label={g.name}
                sub={sub}
                at={g.lastMessage.at}
                unread={g.unread}
                onOpen={() => router.push(`/messages/g/${g.id}` as never)}
                onShow={() => hiding.unhide({ groupId: g.id })}
              />
            );
          }}
          ListEmptyComponent={
            q.isLoading ? (
              <Pulse style={{ paddingVertical: 8, gap: 16 }}>
                {[0, 1, 2].map((i) => <View key={i} style={{ height: 52, borderRadius: 16, backgroundColor: colors.zinc100 }} />)}
              </Pulse>
            ) : q.isError && !q.data ? (
              <View style={st.empty}>
                <Icon name="alert" size={40} color={colors.zinc300} />
                <Text style={st.emptyTitle}>{t('Não consegui carregar')}</Text>
                <Pressable onPress={() => void q.refetch()} style={st.retry} accessibilityRole="button"><Text style={st.retryText}>{t('Tentar outra vez')}</Text></Pressable>
              </View>
            ) : (
              <View style={st.empty}>
                <View style={st.emptyIcon}><Icon name="eye-off" size={30} color={colors.zinc500} /></View>
                <Text style={st.emptyTitle}>{HIDDEN_EMPTY.title}</Text>
                <Text style={st.emptySub}>{HIDDEN_EMPTY.body}</Text>
              </View>
            )
          }
        />
      </HiddenLock>
    </View>
  );
}

function HiddenRow({ photo, name, label, sub, at, unread, marked = false, onOpen, onShow }: {
  photo: ReactNode; name: ReactNode; label: string; sub: string; at: string; unread: number; marked?: boolean; onOpen: () => void; onShow: () => void;
}) {
  const time = listTime(at);
  const badge = unreadBadge(unread, marked);
  const hot = unread > 0;
  return (
    <View style={st.row}>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [st.open, pressed && { backgroundColor: colors.zinc100 }]}
        accessibilityRole="button"
        accessibilityLabel={rowLabel(label, sub, time, unread, marked)}
        accessibilityHint={t('Toca para abrir')}
        accessibilityActions={[{ name: 'show', label: t('Mostrar outra vez') }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'show') onShow(); }}
      >
        {photo}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={st.line}>
            <View style={{ flex: 1, minWidth: 0 }}>{name}</View>
            {time ? <Text style={[st.time, hot && st.timeHot]}>{time}</Text> : null}
          </View>
          <View style={st.line}>
            <Text style={[st.sub, hot && st.subHot]} numberOfLines={1}>{sub}</Text>
            {badge === 'dot' ? <View style={st.dot} /> : badge ? <View style={st.count}><Text style={st.countText}>{badge}</Text></View> : null}
          </View>
        </View>
      </Pressable>
      <Pressable onPress={onShow} hitSlop={6} style={({ pressed }) => [st.show, pressed && { backgroundColor: colors.zinc200 }]} accessibilityRole="button" accessibilityLabel={t('Mostrar outra vez a conversa com {label}', { label })}>
        <Icon name="eye" size={16} color={colors.zinc800} />
        <Text style={st.showText}>{t('Mostrar')}</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  back: { width: 44, height: 44, borderRadius: 22 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12, marginBottom: 8, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 12 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 19, color: colors.zinc600 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 },
  name: { fontSize: 16, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  sub: { flex: 1, minWidth: 0, fontSize: 14, color: colors.zinc500 },
  subHot: { fontWeight: '600', color: colors.zinc900 },
  time: { fontSize: 12, fontWeight: '500', color: colors.zinc500, fontVariant: ['tabular-nums'] },
  timeHot: { color: colors.brand, fontWeight: '700' },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, lineHeight: 15, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 5, backgroundColor: colors.brand },
  show: { height: 36, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 12 },
  showText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  empty: { marginTop: 48, alignItems: 'center', paddingHorizontal: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 19, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  emptySub: { marginTop: 6, maxWidth: 320, fontSize: 15, lineHeight: 21, color: colors.zinc600, textAlign: 'center' },
  retry: { marginTop: 14, height: 44, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
