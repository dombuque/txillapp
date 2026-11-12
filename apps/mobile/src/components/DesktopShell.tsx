import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MessagesScreen from '@/app/(tabs)/messages';
import { api } from '@/lib/api';
import { feedApi } from '@/lib/api.feed';
import { useAuth } from '@/lib/auth';
import { useDesktopSizes } from '@/lib/desktop';
import { emitTabPress, sameTabPress } from '@/lib/tabPress';
import { colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { NewBadge } from './WhatsNew';
import { Icon, type IconName } from './Icon';
import { VerifiedBadge } from './VerifiedBadge';
import { Wordmark } from './Wordmark';

const badge = (n: number) => (n > 9 ? '9+' : String(n));
type HoverState = { pressed: boolean; hovered?: boolean };

/**
 * Modo computador (browser largo): barra lateral fixa com a navegação (como o Instagram no computador), o conteúdo ao centro
 * com a largura certa para cada ecrã e, no Início, uma coluna à direita com a tua conta e sugestões de pessoas.
 * As Mensagens ficam em dois painéis: a lista à esquerda e a conversa à direita.
 * A estrutura é sempre a mesma (só mudam os estilos), para a navegação não recomeçar ao trocar de ecrã.
 */
export function DesktopShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { labels, rightRail } = useDesktopSizes();
  const msgs = path === '/messages' || path.startsWith('/messages/');
  const msgsHome = path === '/messages';
  const home = path === '/';
  // À tua volta: o mapa ocupa a área toda (com a lista numa coluna à direita).
  const full = msgs || path.startsWith('/reels') || path.startsWith('/r/') || path.startsWith('/stories/') || path === '/perto';
  const wide = /^\/(profile|u\/|search|t\/|tag\/|place\/|v\/|saved|locais|geleira|insights|evento|settings)/.test(path); // Definições: duas colunas
  const main = full ? st.mainFull : { ...st.main, maxWidth: wide ? 935 : 630 };
  return (
    <View style={st.shell}>
      <Sidebar labels={labels} path={path} />
      <View style={[st.area, !full && st.areaPad]}>
        {msgs ? <View style={st.msgList}><MessagesScreen /></View> : null}
        <View style={main}>
          {msgsHome ? <MessagesEmpty /> : null}
          <View style={[{ flex: 1 }, msgsHome && { display: 'none' }]}>{children}</View>
        </View>
        {home && rightRail ? <RightRail /> : null}
      </View>
    </View>
  );
}

function Sidebar({ labels, path }: { labels: boolean; path: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const inSettings = path === '/settings' || path.startsWith('/settings/');
  const unread = useQuery({ queryKey: ['unread'], queryFn: api.unreadCount, refetchInterval: 30_000, staleTime: 10_000 });
  const chats = useQuery({ queryKey: ['chat-unread'], queryFn: api.chatUnread, refetchInterval: 20_000, staleTime: 8_000 });
  const items: { key: string; label: string; icon?: IconName; to: string; active: boolean; count?: number }[] = [
    { key: 'home', label: 'Início', icon: 'home', to: '/', active: path === '/' },
    { key: 'search', label: 'Pesquisar', icon: 'search', to: '/search', active: path === '/search' },
    { key: 'reels', label: 'Tchekas', icon: 'film', to: '/reels', active: path.startsWith('/reels') || path.startsWith('/r/') },
    { key: 'perto', label: 'À tua volta', icon: 'map-pin', to: '/perto', active: path === '/perto' || path.startsWith('/evento') },
    { key: 'messages', label: 'Mensagens', icon: 'messages', to: '/messages', active: path.startsWith('/messages'), count: chats.data?.conversations ?? 0 },
    { key: 'bell', label: 'Notificações', icon: 'bell', to: '/notifications', active: path === '/notifications', count: unread.data?.count ?? 0 },
    { key: 'new', label: 'Criar', icon: 'square-plus', to: '/new', active: path === '/new' },
    { key: 'zas', label: 'Zás', icon: 'bolt', to: '/new?kind=zas', active: false },
    { key: 'profile', label: 'Perfil', to: '/profile', active: path === '/profile' || (!!user && path === `/u/${user.username}`) },
  ];
  function go(it: (typeof items)[number]) {
    // Já no Início, nas Mensagens ou no Perfil: volta ao topo (no Início também atualiza), como a barra de baixo do telemóvel.
    const tab = sameTabPress(it.key, path);
    if (tab) return emitTabPress(tab);
    router.navigate((it.key === 'zas' ? `/new?kind=zas&t=${Date.now()}` : it.to) as never);
  }
  return (
    <View style={[st.side, { width: labels ? 244 : 76 }]} role="navigation" accessibilityLabel="Navegação principal">
      <Pressable onPress={() => router.navigate('/' as never)} style={[st.brand, !labels && { alignItems: 'center', paddingHorizontal: 0 }]} accessibilityRole="link" accessibilityLabel="Txillapp, ir para o Início">
        {labels ? <Wordmark height={30} /> : <Image source={{ uri: '/icon-192.png' }} style={{ width: 34, height: 34, borderRadius: 10 }} contentFit="cover" />}
      </Pressable>
      <View style={{ gap: 4 }}>
        {items.map((it) => (
          <Pressable
            key={it.key}
            onPress={() => go(it)}
            style={(s) => [st.item, !labels && st.itemIcon, (s as HoverState).hovered && st.itemHover, (s as HoverState).pressed && { transform: [{ scale: 0.97 }] }]}
            accessibilityRole="link"
            accessibilityLabel={it.count ? `${it.label} (${it.count} por ler)` : it.label}
            accessibilityState={{ selected: it.active }}
          >
            <View>
              {it.key === 'profile' ? (
                <View style={[st.ava, { borderColor: it.active ? colors.zinc900 : 'transparent' }]}>
                  <Avatar name={user?.displayName ?? '?'} username={user?.username} size={26} />
                </View>
              ) : (
                <Icon name={it.icon!} size={27} color={it.key === 'new' ? colors.green600 : colors.zinc900} solid={it.active && (it.icon === 'home' || it.icon === 'messages' || it.icon === 'bell' || it.icon === 'map-pin')} strokeWidth={it.active ? 2.4 : 1.9} />
              )}
              {it.count ? <View style={st.badge}><Text style={st.badgeText}>{badge(it.count)}</Text></View> : null}
            </View>
            {labels ? <Text style={[st.label, it.active && { fontWeight: '800' }]} numberOfLines={1}>{it.label}</Text> : null}
            {it.key === 'zas' ? <View style={labels ? { marginLeft: -6 } : { position: 'absolute', right: -6, top: 2 }}><NewBadge id="zas" /></View> : null}
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => router.navigate('/settings' as never)}
        style={(s) => [st.item, !labels && st.itemIcon, (s as HoverState).hovered && st.itemHover, { marginBottom: 20 }]}
        accessibilityRole="link"
        accessibilityLabel="Mais: definições, guardados, carteira e sair"
        accessibilityState={{ selected: inSettings }}
      >
        <Icon name="menu" size={27} color={colors.zinc900} strokeWidth={inSettings ? 2.4 : 1.9} />
        {labels ? <Text style={[st.label, inSettings && { fontWeight: '800' }]}>Mais</Text> : null}
      </Pressable>
    </View>
  );
}

/** Início no computador, à direita: a tua conta, sugestões de pessoas e as ligações de rodapé. */
function RightRail() {
  const router = useRouter();
  const { user } = useAuth();
  const sugg = useQuery({ queryKey: ['suggestions'], queryFn: feedApi.suggestions, staleTime: 60_000 });
  const people = (sugg.data ?? []).slice(0, 6);
  const links: [string, string][] = [['Sobre', '/about'], ['Ajuda', '/help'], ['Termos', '/terms'], ['Privacidade', '/privacy'], ['Idioma', '/language']];
  return (
    <ScrollView style={st.rail} contentContainerStyle={{ paddingTop: 36, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      {user ? (
        <Pressable onPress={() => router.navigate('/profile' as never)} style={st.meRow} accessibilityRole="link" accessibilityLabel="O teu perfil">
          <Avatar name={user.displayName} username={user.username} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.meName} numberOfLines={1}>{user.displayName}</Text>
            <Text style={st.meHandle} numberOfLines={1}>@{user.username}</Text>
          </View>
          <Text style={st.link}>Ver perfil</Text>
        </Pressable>
      ) : null}
      {people.length > 0 ? (
        <>
          <View style={st.railHead}>
            <Text style={st.railTitle}>Sugestões para ti</Text>
            <Pressable onPress={() => router.navigate('/search' as never)} accessibilityRole="link"><Text style={st.seeAll}>Ver mais</Text></Pressable>
          </View>
          {people.map((p) => (
            <View key={p.username} style={st.person}>
              <Pressable onPress={() => router.push(`/u/${p.username}` as never)} style={st.personLink} accessibilityRole="link" accessibilityLabel={`Perfil de ${p.displayName}`}>
                <Avatar name={p.displayName} username={p.username} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={st.pName} numberOfLines={1}>{p.displayName}</Text>
                    {(p as { verified?: boolean }).verified ? <VerifiedBadge size={14} /> : null}
                  </View>
                  <Text style={st.pReason} numberOfLines={1}>{p.reason || `@${p.username}`}</Text>
                </View>
              </Pressable>
              <View style={{ width: 104 }}>
                <FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} />
              </View>
            </View>
          ))}
        </>
      ) : null}
      <View style={st.foot}>
        {links.map(([label, to]) => (
          <Pressable key={to} onPress={() => router.push(to as never)} accessibilityRole="link"><Text style={st.footLink}>{label}</Text></Pressable>
        ))}
      </View>
      <Text style={st.copy}>© {new Date().getFullYear()} Txillapp</Text>
    </ScrollView>
  );
}

/** Mensagens no computador sem conversa aberta. */
function MessagesEmpty() {
  const router = useRouter();
  return (
    <View style={st.empty}>
      <View style={st.emptyIcon}><Icon name="messages" size={40} color={colors.zinc900} /></View>
      <Text style={st.emptyTitle}>As tuas mensagens</Text>
      <Text style={st.emptySub}>Escolhe uma conversa à esquerda ou começa uma nova com a malta.</Text>
      <Pressable onPress={() => router.push('/messages/new' as never)} style={st.emptyBtn} accessibilityRole="button"><Text style={st.emptyBtnText}>Nova mensagem</Text></Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.white },
  side: { borderRightWidth: 1, borderRightColor: colors.zinc100, paddingHorizontal: 12, paddingTop: 8, backgroundColor: colors.white },
  brand: { height: 76, justifyContent: 'center', paddingHorizontal: 12, marginBottom: 8 },
  item: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12, borderRadius: 14 },
  itemIcon: { justifyContent: 'center', paddingHorizontal: 0, width: 52, alignSelf: 'center' },
  itemHover: { backgroundColor: colors.zinc100 },
  label: { fontSize: 16, color: colors.zinc900, fontWeight: '500' },
  ava: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -9, top: -7, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700', lineHeight: 13 },
  area: { flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'center' },
  areaPad: { paddingHorizontal: 24, gap: 48 },
  main: { flex: 1, minWidth: 0, width: '100%' },
  mainFull: { flex: 1, minWidth: 0 },
  msgList: { width: 380, borderRightWidth: 1, borderRightColor: colors.zinc100 },
  rail: { width: 320, flexGrow: 0, flexShrink: 0 },
  meRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  meName: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  meHandle: { fontSize: 14, color: colors.zinc500 },
  link: { fontSize: 13, fontWeight: '700', color: colors.brand },
  railHead: { marginTop: 28, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  railTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc600 },
  seeAll: { fontSize: 13, fontWeight: '700', color: colors.zinc900 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  personLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pName: { fontSize: 14, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  pReason: { fontSize: 12, color: colors.zinc500 },
  foot: { marginTop: 28, flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 4, paddingHorizontal: 4 },
  footLink: { fontSize: 12, color: colors.zinc500 },
  copy: { marginTop: 12, fontSize: 12, color: colors.zinc500, paddingHorizontal: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyIcon: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: colors.zinc900, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  emptySub: { fontSize: 15, color: colors.zinc600, textAlign: 'center', maxWidth: 320 },
  emptyBtn: { marginTop: 12, height: 40, paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
