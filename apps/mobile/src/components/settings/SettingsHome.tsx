import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { EditProfileSheet } from '@/components/ProfileSheets';
import { showsOffBanner, useDeviceNotifications } from '@/components/PushReminder';
import { accounts } from '@/lib/accounts';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SETTINGS_GROUPS, searchSettings, type SettingsGroupId, type SettingsHit } from '@/lib/settingsIndex';
import { colors } from '@/lib/theme';
import { SettingRow, SettingsSection } from './SettingRow';
import { LogoutSheet, SwitchAccountSheet } from './sheets';
import { useLeave } from './useLeave';

/** Opções que este aparelho não mostra: a pesquisa também não as propõe. */
const HIDDEN_HERE = Platform.OS === 'web' ? [] : ['installApp', 'contacts'];

/** O cartão do perfil no topo: foto, nome, @ e "Editar perfil". */
function ProfileCard() {
  const { user } = useAuth();
  const [edit, setEdit] = useState(false);
  const me = user?.username ?? '';
  const profile = useQuery({ queryKey: ['profile', me], queryFn: () => api.profile(me), enabled: !!user });
  // A terminar sessão, o ecrã ainda se desenha uma vez já sem conta: sem cartão, em vez de rebentar.
  if (!user) return null;
  const name = profile.data?.displayName ?? user.displayName;
  return (
    <>
      <Pressable
        onPress={() => profile.data && setEdit(true)}
        style={({ pressed }) => [st.me, pressed && { transform: [{ scale: 0.99 }] }]}
        accessibilityRole="button"
        accessibilityLabel={`${name}, @${user.username}. Editar perfil`}
      >
        <Avatar name={name} username={profile.data?.hasAvatar ? user.username : undefined} size={60} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.meName} numberOfLines={2}>{name}</Text>
          <Text style={st.meHandle} numberOfLines={1}>@{user.username}</Text>
          <Text style={st.meEdit}>Editar perfil</Text>
        </View>
        <Icon name="chevron-right" size={18} color="#a1a1aa" />
      </Pressable>
      {edit && profile.data ? <EditProfileSheet profile={profile.data} onClose={() => setEdit(false)} /> : null}
    </>
  );
}

/** "Procurar nas definições": encontra qualquer opção pelo nome ou por um sinónimo e leva direto a ela. */
function SettingsSearch({ query, onChange }: { query: string; onChange: (q: string) => void }) {
  return (
    <View style={st.search}>
      <Icon name="search" size={18} color={colors.zinc500} />
      <TextInput
        value={query}
        onChangeText={onChange}
        placeholder="Procurar nas definições"
        placeholderTextColor={colors.zinc500}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={st.searchInput}
        accessibilityLabel="Procurar nas definições"
      />
      {query ? (
        <Pressable onPress={() => onChange('')} style={st.clear} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa" hitSlop={6}>
          <Icon name="x" size={16} color={colors.zinc600} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Results({ hits, onPick }: { hits: SettingsHit[]; onPick: (h: SettingsHit) => void }) {
  if (hits.length === 0) {
    return <Text style={st.noHits} accessibilityLiveRegion="polite">Nada com esse nome. Experimenta outra palavra, como "privado", "senha" ou "notificações".</Text>;
  }
  return (
    <SettingsSection title={hits.length === 1 ? '1 resultado' : `${hits.length} resultados`}>
      {hits.map((h) => {
        const g = h.kind === 'group' ? SETTINGS_GROUPS.find((x) => x.id === h.id) : undefined;
        return <SettingRow key={`${h.kind}-${h.id}`} icon={(g?.icon ?? 'settings') as IconName} title={h.title} description={g ? g.subtitle : h.where} onPress={() => onPick(h)} />;
      })}
    </SettingsSection>
  );
}

/**
 * O início das Definições: o perfil, a pesquisa, a lista curta dos grupos e, no fundo, as contas e sair.
 * No telemóvel é o ecrã /settings; no computador fica sempre à esquerda, com o grupo aberto à direita (`pane`).
 */
export function SettingsHome({ pane = false }: { pane?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const { user, switchTo } = useAuth();
  const leave = useLeave();
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<null | 'logout' | 'switch'>(null);
  const [others, setOthers] = useState<{ username: string; displayName: string }[]>([]);
  useEffect(() => {
    void accounts.list().then((l) => setOthers(l.filter((a) => a.username !== user?.username)));
  }, [user?.username]);
  const { device } = useDeviceNotifications();
  const notifOff = showsOffBanner(device);

  const open = (to: string) => router.push(to as never);
  // No telemóvel a pesquisa fica: limpá-la aqui trocava os resultados pela lista dos grupos a meio da animação (via-se por
  // trás do ecrã a entrar) e, ao voltar, a pessoa perdia o que procurou. No computador a lista da esquerda volta aos grupos,
  // com o grupo aberto assinalado.
  const pick = (h: SettingsHit) => { if (pane) setQuery(''); open(h.path); };
  // No computador, o grupo aberto fica assinalado (em /settings abre-se a Conta).
  const active = (id: SettingsGroupId) => pane && (path === `/settings/${id}` || (id === 'conta' && path === '/settings') || (id === 'seguranca' && path === '/settings/aparelhos'));
  const hits = query.trim() ? searchSettings(query, { hidden: HIDDEN_HERE }) : null;

  return (
    <View>
      <ProfileCard />
      <View style={{ marginTop: 16, paddingHorizontal: 16 }}>
        <SettingsSearch query={query} onChange={setQuery} />
      </View>
      {hits ? (
        <Results hits={hits} onPick={pick} />
      ) : (
        <>
          <SettingsSection>
            {SETTINGS_GROUPS.map((g) => (
              <GroupRow
                key={g.id}
                icon={g.icon as IconName}
                title={g.title}
                subtitle={g.id === 'notificacoes' && notifOff ? 'Desligadas neste aparelho' : g.subtitle}
                warn={g.id === 'notificacoes' && notifOff}
                active={active(g.id)}
                onPress={() => (pane ? router.navigate(`/settings/${g.id}` as never) : open(`/settings/${g.id}`))}
              />
            ))}
          </SettingsSection>
          <SettingsSection title="Contas">
            <SettingRow anchor="addAccount" icon="user-plus" title="Adicionar conta" onPress={() => { accounts.beginAdd(); open('/login?entrar=1'); }} />
            {others.length > 0 ? <SettingRow anchor="switchAccount" icon="users" title="Trocar de conta" value={`${others.length + 1} contas`} onPress={() => setSheet('switch')} /> : null}
            <SettingRow anchor="logout" icon="logout" title="Terminar sessão" onPress={() => setSheet('logout')} />
          </SettingsSection>
          <Text style={st.foot}>Txillapp · versão {Constants.expoConfig?.version ?? '?'}</Text>
        </>
      )}
      {sheet === 'switch' && <SwitchAccountSheet others={others} onPick={(u) => void switchTo(u)} onClose={() => setSheet(null)} />}
      {sheet === 'logout' && <LogoutSheet onConfirm={leave} onClose={() => setSheet(null)} />}
    </View>
  );
}

/** Uma linha da lista dos grupos: ícone, título e subtítulo de uma linha. */
function GroupRow({ icon, title, subtitle, warn, active, onPress }: { icon: IconName; title: string; subtitle: string; warn?: boolean; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={(s) => [st.group, active && st.groupActive, (s.pressed || (s as { hovered?: boolean }).hovered) && !active && { backgroundColor: '#fafafa' }]}
      accessibilityRole="link"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ selected: !!active }}
      aria-selected={!!active}
    >
      <View style={[st.groupIcon, active && { backgroundColor: colors.white }, warn && { backgroundColor: colors.rose50 }]}>
        <Icon name={warn ? 'bell-off' : icon} size={20} color={warn ? colors.brand : colors.zinc800} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.groupTitle, active && { fontWeight: '800' }]}>{title}</Text>
        <Text style={[st.groupSub, warn && { color: colors.brand, fontWeight: '600' }]} numberOfLines={2}>{subtitle}</Text>
      </View>
      <Icon name="chevron-right" size={18} color="#a1a1aa" />
    </Pressable>
  );
}

const st = StyleSheet.create({
  me: { minHeight: 92, marginHorizontal: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 24, backgroundColor: '#fff', padding: 16, borderWidth: 1, borderColor: colors.zinc100, boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
  meName: { fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  meHandle: { fontSize: 14, color: colors.zinc600 },
  meEdit: { marginTop: 2, fontSize: 14, fontWeight: '600', color: colors.brand },
  search: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, backgroundColor: colors.zinc100, paddingLeft: 14, paddingRight: 4 },
  searchInput: { flex: 1, minHeight: 46, paddingVertical: 10, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  clear: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  noHits: { marginTop: 28, paddingHorizontal: 32, textAlign: 'center', fontSize: 15, lineHeight: 21, color: colors.zinc600 },
  group: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.white },
  groupActive: { backgroundColor: colors.zinc100 },
  groupIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  groupSub: { marginTop: 1, fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  foot: { marginTop: 20, textAlign: 'center', fontSize: 12, color: colors.zinc500 },
});
