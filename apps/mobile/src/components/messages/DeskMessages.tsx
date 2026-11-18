import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MessagesScreen, { what } from '@/app/(tabs)/messages';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { NoteView } from '@/components/Notes';
import { Button } from '@/components/ui/Button';
import { GroupCover } from '@/components/groups/GroupParts';
import { groupCardData } from '@/components/groups/GroupCard';
import { api } from '@/lib/api';
import type { TxillGroupSummary } from '@/lib/api.groups';
import { notesApi, type Note } from '@/lib/api.notes';
import { useAuth } from '@/lib/auth';
import { emptyPreview } from '@/lib/chatTemporary';
import { deskZone, isMac, useDeskChat, useDeskChatChrome } from '@/lib/deskChat';
import { LIST_W_MEDIUM, msgListWidth, recentChats } from '@/lib/deskMessages';
import { groupSenderPrefix, listTime, unreadBadge } from '@/lib/inboxRow';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

type HoverState = { pressed: boolean; hovered?: boolean };

/**
 * Mensagens no computador, a coluna da esquerda: a lista das conversas (app/(tabs)/messages) com a largura certa para o
 * ecrã (lib/deskMessages `msgListWidth`: 320 nos ecrãs médios, de 360 a 420 nos largos) e um separador fino.
 * O DesktopShell põe-na antes do painel da conversa; o resto (cabeçalho fixo, notas com setas, atalhos) é da lista.
 */
export function DeskMessagesList() {
  const { width } = useWindowDimensions();
  return (
    <View style={[st.list, { width: msgListWidth(width) ?? LIST_W_MEDIUM }]}>
      <MessagesScreen />
    </View>
  );
}

/**
 * Mensagens no computador sem conversa aberta: em vez de um vazio, «As tuas mensagens» com as 6 conversas mais
 * recentes em cartões, as notas da malta, «Nova mensagem» em destaque e as teclas que dão jeito.
 */
export function DeskMessagesHome() {
  const router = useRouter();
  const { user } = useAuth();
  const desk = useDeskChat();
  useDeskChatChrome(desk);
  const { width } = useWindowDimensions();
  const direct = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, refetchInterval: 60_000 });
  const groups = useQuery({ queryKey: ['chat-groups'], queryFn: api.chatGroups, refetchInterval: 60_000 });
  const notes = useQuery({ queryKey: ['notes'], queryFn: notesApi.list, staleTime: 60_000, refetchInterval: 120_000 });
  const [viewing, setViewing] = useState<Note | null>(null);
  const recent = recentChats(direct.data, groups.data as TxillGroupSummary[] | undefined, 6);
  const malta = (notes.data?.items ?? []).filter((n) => n.username !== user?.username).slice(0, 6);
  // O painel: a janela menos a barra lateral e a lista. Cartões em 3 colunas quando cabem, senão 2.
  const panel = width - (width >= 1264 ? 244 : 76) - (msgListWidth(width) ?? LIST_W_MEDIUM);
  const cols = panel >= 760 ? 3 : 2;
  const cardW = `${Math.floor(10000 / cols) / 100}%` as const;
  const mod = isMac() ? '⌘' : t('Ctrl');
  const keys: [string[], string][] = [[[mod, 'K'], t('Procurar')], [[t('Alt'), '↑', '↓'], t('Mudar de conversa')], [['Esc'], t('Fechar a conversa')], [['?'], t('Todos os atalhos')]];
  return (
    <ScrollView style={st.home} contentContainerStyle={st.homeIn} {...deskZone(desk)}>
      <View style={st.hero}>
        <View style={st.heroIcon}><Icon name="messages" size={30} color="#fff" /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title} accessibilityRole="header">{t('As tuas mensagens')}</Text>
          <Text style={st.sub}>{t('Escolhe uma conversa à esquerda ou começa uma nova com a malta.')}</Text>
        </View>
      </View>
      <View style={st.actions}>
        <Button kind="gradient" size="md" icon="compose" label={t('Nova mensagem')} onPress={() => router.push('/messages/new' as never)} />
        <Button kind="secondary" size="md" icon="users" label={t('Novo TxillGroup')} onPress={() => router.push('/messages/new?group=1' as never)} />
      </View>

      {recent.length > 0 ? (
        <>
          <Text style={st.section} accessibilityRole="header">{t('Recentes')}</Text>
          <View style={st.grid}>
            {recent.map((r) => {
              const badge = unreadBadge(r.unread, !!r.d?.marked);
              const sub = r.d
                ? emptyPreview(r.d.lastMessage) ?? what(r.d.lastMessage)
                : r.g ? emptyPreview(r.g.lastMessage, { members: r.g.members }) ?? `${groupSenderPrefix(r.g.lastMessage)}${what(r.g.lastMessage, true)}` : '';
              const time = listTime(r.at);
              return (
                <View key={r.key} style={[st.cell, { width: cardW }]}>
                  <Pressable
                    onPress={() => router.push(r.to as never)}
                    style={(s) => [st.card, (s as HoverState).hovered && st.cardHover, s.pressed && { transform: [{ scale: 0.98 }] }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('Abrir a conversa com {name}', { name: r.name })}
                  >
                    <View style={st.cardTop}>
                      {r.g
                        ? <GroupCover url={r.g.avatarUrl} kind={groupCardData(r.g).kind} size={44} radius={14} />
                        : <View><Avatar name={r.name} username={r.d?.hasAvatar ? r.d.username : undefined} size={44} />{r.d?.presence?.online ? <View style={st.online} /> : null}</View>}
                      {badge ? (badge === 'dot' ? <View style={st.dot} /> : <View style={st.count}><Text style={st.countText}>{badge}</Text></View>) : time ? <Text style={st.time}>{time}</Text> : null}
                    </View>
                    <NameWithBadge name={r.name} who={r.d} style={[st.cardName, r.unread > 0 && { fontWeight: '800' }]} />
                    <Text style={[st.cardSub, r.unread > 0 && st.cardSubHot]} numberOfLines={2}>{sub}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {malta.length > 0 ? (
        <>
          <Text style={st.section} accessibilityRole="header">{t('Notas da malta')}</Text>
          <View style={st.grid}>
            {malta.map((n) => (
              <View key={n.username} style={[st.cell, { width: cardW }]}>
                <Pressable
                  onPress={() => setViewing(n)}
                  style={(s) => [st.note, (s as HoverState).hovered && st.cardHover]}
                  accessibilityRole="button"
                  accessibilityLabel={t('Nota de {displayName}: {body}', { displayName: n.displayName, body: n.body || n.music?.title || n.place?.name || (n.gif ? 'GIF' : '') })}
                >
                  <Avatar name={n.displayName} username={n.hasAvatar ? n.username : undefined} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <NameWithBadge name={n.displayName} who={n} style={st.noteName} />
                    <Text style={st.noteBody} numberOfLines={1}>{n.body || (n.music ? `${n.music.title}` : n.place?.name ?? (n.gif ? 'GIF' : ''))}</Text>
                  </View>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {desk ? (
        <View style={st.keys} accessibilityLabel={t('Atalhos do teclado')}>
          {keys.map(([ks, label]) => (
            <View key={label} style={st.keyItem}>
              {ks.map((k) => <Text key={k} style={st.kbd}>{k}</Text>)}
              <Text style={st.keyLabel}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {viewing ? <NoteView note={viewing} onClose={() => setViewing(null)} /> : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  list: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.zinc200, backgroundColor: colors.white },
  home: { flex: 1, backgroundColor: '#f7f7f9' },
  homeIn: { flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 32, paddingVertical: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroIcon: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand, boxShadow: '0 8px 20px -10px rgba(214,51,79,0.7)' } as object,
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4, color: colors.zinc900 },
  sub: { marginTop: 2, fontSize: 15, color: colors.zinc600 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  section: { marginTop: 32, marginBottom: 10, fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.zinc500 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  cell: { padding: 6 },
  card: { minHeight: 132, borderRadius: 18, padding: 14, gap: 6, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.zinc100, boxShadow: '0 1px 2px rgba(24,24,27,0.04)' } as object,
  cardHover: { borderColor: colors.zinc200, boxShadow: '0 6px 18px -10px rgba(24,24,27,0.25)' } as object,
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
  cardName: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  cardSub: { fontSize: 13.5, lineHeight: 18, color: colors.zinc500 },
  cardSubHot: { color: colors.zinc900, fontWeight: '600' },
  time: { fontSize: 12, fontWeight: '500', color: colors.zinc500 },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, lineHeight: 15, fontWeight: '800', color: '#fff' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 4, backgroundColor: colors.brand },
  online: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white, backgroundColor: '#10b981' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.zinc100 },
  noteName: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  noteBody: { fontSize: 13, color: colors.zinc600 },
  keys: { marginTop: 32, flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8 },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kbd: { minWidth: 24, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1, borderColor: colors.zinc300, backgroundColor: colors.white, fontSize: 12, fontWeight: '700', color: colors.zinc700, textAlign: 'center' },
  keyLabel: { marginLeft: 2, fontSize: 13, color: colors.zinc500 },
});
