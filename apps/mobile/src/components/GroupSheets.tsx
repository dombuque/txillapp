import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError, type Badged } from '@/lib/api';
import { gruposApi, type GroupMember, type GroupThread } from '@/lib/api.grupos';
import { groupKindOf, groupsApi, kindInfo, type TxillGroupInfo } from '@/lib/api.groups';
import { GroupDetailsForm, GroupEditSheet, draftError, emptyDraft, type GroupDraft } from './groups/GroupDetails';
import { GroupAccessSection } from './groups/GroupAccess';
import { ConfirmSheet, GroupCover } from './groups/GroupParts';
import { accessOf } from '@/lib/groupAccess';
import { LAST_ADMIN_MESSAGE, adminCount, memberActions, roleBadge, roleDoneText, stepDownNote, withRole, type MemberAction } from '@/lib/groupRoles';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { NameWithBadge } from './NameWithBadge';
import { Sheet } from './Sheet';

interface Person extends Badged { username: string; displayName: string; hasAvatar: boolean }

/**
 * Nova conversa (igual ao NewChat do site): procura uma pessoa e conversa, ou cria um TxillGroup. O TxillGroup tem nome, tipo,
 * descrição e capa: pelo "Novo TxillGroup" preenche-se isso primeiro e depois escolhe-se a malta; escolhendo duas ou mais pessoas
 * na lista, o "Seguinte" leva aos dados. Com `addTo`, serve para adicionar pessoas a um TxillGroup que já existe.
 */
export function NewChatSheet({ onClose, addTo, startGroup = false }: { onClose: () => void; addTo?: { groupId: string; have: string[]; onAdded: () => void }; startGroup?: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);
  // Criar TxillGroup: `detailsFirst` = veio do "Novo TxillGroup" (dados primeiro, malta depois).
  const [groupFlow, setGroupFlow] = useState(startGroup);
  const [detailsFirst, setDetailsFirst] = useState(startGroup);
  const [step, setStep] = useState<'pick' | 'details'>(startGroup ? 'details' : 'pick');
  const [draft, setDraft] = useState<GroupDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const recent = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, staleTime: 30_000 });
  const term = text.trim().replace(/^@/, '');
  const search = useQuery({ queryKey: ['mentionable', term], queryFn: () => api.mentionable(term), enabled: term.length >= 1, staleTime: 30_000 });
  const have = new Set((addTo?.have ?? []).map((u) => u.toLowerCase()));

  const rows: Person[] = (term ? search.data ?? [] : (recent.data ?? []).map((c) => ({ username: c.username, displayName: c.displayName, hasAvatar: c.hasAvatar, verified: c.verified, verifiedTier: c.verifiedTier }))).filter((p) => !have.has(p.username.toLowerCase()));
  const isPicked = (u: string) => picked.some((p) => p.username === u);
  const toggle = (p: Person) => setPicked((l) => (isPicked(p.username) ? l.filter((x) => x.username !== p.username) : [...l, p]));

  async function create() {
    const bad = draftError(draft);
    if (bad) { setStep('details'); return setErr(bad); }
    if (picked.length < 2) { setStep('pick'); return setErr('Um TxillGroup precisa de pelo menos mais duas pessoas.'); }
    setBusy(true);
    try {
      const r = await groupsApi.create({
        name: draft.name.trim(),
        kind: draft.kind,
        ...(draft.description.trim() ? { description: draft.description.trim() } : null),
        ...(draft.coverMediaId ? { coverMediaId: draft.coverMediaId } : null),
        ...(draft.avatarMediaId ? { avatarMediaId: draft.avatarMediaId } : null),
        members: picked.map((p) => p.username),
      });
      void qc.invalidateQueries({ queryKey: ['chat-groups'] });
      onClose();
      router.push(`/messages/g/${r.id}` as never);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  async function go() {
    setErr('');
    if (addTo) {
      setBusy(true);
      try {
        await gruposApi.add(addTo.groupId, picked.map((p) => p.username));
        addTo.onAdded();
        onClose();
      } catch (e) {
        setErr((e as Error).message);
        setBusy(false);
      }
      return;
    }
    if (step === 'details') {
      const bad = draftError(draft);
      if (bad) return setErr(bad);
      if (detailsFirst) return setStep('pick');
      return void create();
    }
    if (groupFlow) return void create();
    if (picked.length === 1) {
      onClose();
      return router.push(`/messages/${picked[0].username}` as never);
    }
    setGroupFlow(true);
    setDetailsFirst(false);
    setStep('details');
  }
  function back() {
    setErr('');
    if (step === 'details' && !detailsFirst) { setGroupFlow(false); return setStep('pick'); }
    if (step === 'pick' && detailsFirst) return setStep('details');
    setGroupFlow(false);
    setDetailsFirst(false);
    setStep('pick');
  }

  const label = addTo
    ? `Adicionar ${picked.length || ''}`.trim()
    : step === 'details' ? (detailsFirst ? 'Escolher a malta' : 'Criar TxillGroup')
    : groupFlow ? (picked.length >= 2 ? `Criar TxillGroup · ${picked.length + 1} pessoas` : 'Escolhe pelo menos duas pessoas')
    : picked.length === 1 ? 'Conversar' : picked.length > 1 ? 'Seguinte' : 'Escolhe pessoas';
  const title = addTo ? 'Adicionar ao TxillGroup' : step === 'details' ? 'Novo TxillGroup' : groupFlow ? 'Quem vem?' : 'Nova conversa';
  const disabled = busy || (step === 'pick' && (groupFlow ? picked.length < 2 : picked.length === 0));

  return (
    <Sheet title={title} onClose={onClose} full plain>
      <Text style={{ textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.zinc900, paddingHorizontal: 16, paddingBottom: 8 }}>{title}</Text>
      {step === 'details' ? (
        <View style={{ flex: 1 }}>
          <GroupDetailsForm draft={draft} onChange={setDraft} />
          {picked.length > 0 && (
            <View style={styles.chosen}>
              {picked.map((p) => (
                <View key={p.username} style={{ width: 64, alignItems: 'center', gap: 4 }}>
                  <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={44} />
                  <NameWithBadge name={p.displayName.split(' ')[0]} who={p} center gap={2} style={[styles.chipName, { width: undefined }]} />
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16 }}>
            <View style={styles.search}>
              <Icon name="search" size={18} color={colors.zinc500} />
              <TextInput value={text} onChangeText={setText} placeholder="Procurar" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar pessoas" style={styles.searchInput} autoCapitalize="none" />
            </View>
            {!addTo && !groupFlow && !term && (
              <Pressable onPress={() => { setErr(''); setGroupFlow(true); setDetailsFirst(true); setStep('details'); }} style={({ pressed }) => [styles.add, { marginTop: 8 }, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
                <View style={styles.addIcon}><Icon name="users" size={22} color={colors.brand} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName}>Novo TxillGroup</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>Viagem, festa ou fim de semana, com Plano e Txills</Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.zinc500} />
              </Pressable>
            )}
            {picked.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, flexGrow: 0 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
                {picked.map((p) => (
                  <Pressable key={p.username} onPress={() => toggle(p)} accessibilityLabel={`Tirar ${p.displayName}`} style={{ width: 60, alignItems: 'center', gap: 4 }}>
                    <View>
                      <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={52} />
                      <View style={styles.remove}><Icon name="x" size={12} strokeWidth={3} color="#fff" /></View>
                    </View>
                    <NameWithBadge name={p.displayName.split(' ')[0]} who={p} center gap={2} style={[styles.chipName, { width: undefined }]} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
          <FlatList
            data={rows}
            keyExtractor={(p) => p.username}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 8 }}
            ListHeaderComponent={!term && rows.length > 0 ? <Text style={styles.sugg}>Sugestões</Text> : undefined}
            ListEmptyComponent={<Text style={styles.none}>{term ? 'Ninguém com esse nome' : 'Procura pelo nome ou @.'}</Text>}
            renderItem={({ item: p }) => {
              const on = isPicked(p.username);
              return (
                <Pressable onPress={() => toggle(p)} accessibilityState={{ selected: on }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.zinc100 }]}>
                  <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={46} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <NameWithBadge name={p.displayName} who={p} style={styles.rowName} />
                    <Text style={styles.rowSub} numberOfLines={1}>@{p.username}</Text>
                  </View>
                  <View style={[styles.check, on && { borderColor: colors.brand, backgroundColor: colors.brand }]}>{on && <Icon name="check" size={14} strokeWidth={3} color="#fff" />}</View>
                </Pressable>
              );
            }}
          />
        </View>
      )}
      <View style={styles.foot}>
        {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!addTo && (groupFlow || step === 'details') && <Pressable onPress={back} style={styles.back}><Text style={styles.backText}>Voltar</Text></Pressable>}
          <Pressable onPress={() => void go()} disabled={disabled} style={[styles.go, disabled && { opacity: 0.4 }]} accessibilityRole="button">
            <Text style={styles.goText}>{busy ? 'A criar…' : label}</Text>
          </Pressable>
        </View>
        {!addTo && !groupFlow && picked.length === 1 && <Text style={styles.hint}>Escolhe mais pessoas para criar um TxillGroup.</Text>}
      </View>
    </Sheet>
  );
}

/**
 * Membros do TxillGroup: quem administra edita o nome, o tipo e a capa, adiciona e tira pessoas e escolhe quem mais administra
 * (no menu "⋯" de cada pessoa); qualquer pessoa pode sair.
 */
export function GroupInfoSheet({ group, onClose, onChanged, onLeft }: { group: TxillGroupInfo; onClose: () => void; onChanged: () => void; onLeft: () => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const admin = group.myRole === 'admin';
  const me = user?.username ?? '';
  const admins = adminCount(group.members);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [kick, setKick] = useState<GroupMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  // A pessoa do menu sempre com os dados mais recentes (o papel muda enquanto o menu está aberto).
  const menuMember = menuFor ? group.members.find((x) => x.username === menuFor) ?? null : null;

  async function run(job: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setErr('');
    try {
      await job();
      after?.();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function done(text: string) {
    setNotice(text);
    AccessibilityInfo.announceForAccessibility?.(text);
  }

  /** Muda o papel na conversa em cache (otimista); o refetch do `onChanged` confirma ou desfaz. */
  function patchRole(username: string, role: GroupMember['role']) {
    qc.setQueryData<InfiniteData<GroupThread>>(['chat-group', group.id], (d) => d && {
      ...d,
      pages: d.pages.map((p, i) => (i ? p : { ...p, group: { ...p.group, members: withRole(p.group.members, username, role), myRole: username.toLowerCase() === me.toLowerCase() ? role : p.group.myRole } })),
    });
  }

  async function setRole(m: GroupMember, a: MemberAction) {
    const role = a.role!;
    const before = m.role;
    // Deixar eu de ser administrador não é otimista: se for o último, o servidor recusa e o menu não pisca.
    const optimistic = a.id !== 'step_down';
    if (optimistic) patchRole(m.username, role);
    try {
      await groupsApi.setMemberRole(group.id, m.username, role);
      done(roleDoneText(a.id, m.displayName));
      setMenuFor(null);
    } catch (e) {
      if (optimistic) patchRole(m.username, before);
      // 409: era o último administrador. O servidor diz porquê; sem mensagem, diz-se o mesmo.
      throw new Error((e as Error).message || (e instanceof ApiError && e.status === 409 ? LAST_ADMIN_MESSAGE : 'Não consegui mudar. Tenta outra vez.'));
    } finally {
      onChanged();
    }
  }

  if (adding) return <NewChatSheet onClose={() => setAdding(false)} addTo={{ groupId: group.id, have: group.members.map((m) => m.username), onAdded: onChanged }} />;

  if (confirm) {
    return (
      <Sheet title="Sair do TxillGroup?" onClose={() => setConfirm(false)}>
        <View style={{ paddingHorizontal: 24 }}>
          <Text style={styles.confirmText}>Deixas de receber as mensagens de “{group.name}”. Só voltas se alguém te adicionar.</Text>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Pressable disabled={busy} onPress={() => void run(() => gruposApi.remove(group.id, user!.username), onLeft)} style={[styles.leave, busy && { opacity: 0.5 }]}><Text style={styles.goText}>Sair do TxillGroup</Text></Pressable>
          <Pressable onPress={() => setConfirm(false)} style={styles.stay}><Text style={styles.backText}>Ficar</Text></Pressable>
        </View>
      </Sheet>
    );
  }

  if (editing) return <GroupEditSheet group={group} onClose={() => setEditing(false)} onSaved={onChanged} />;

  return (
    <Sheet title={group.name} onClose={onClose} full>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <View style={styles.info}>
          <GroupCover url={group.avatarUrl ?? group.coverUrl} kind={groupKindOf(group)} size={64} radius={group.avatarUrl ? 32 : undefined} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.infoKind}>{kindInfo(groupKindOf(group)).label}</Text>
            {group.description ? <Text style={styles.infoDesc} numberOfLines={4}>{group.description}</Text> : <Text style={[styles.infoDesc, { color: colors.zinc500 }]}>Sem descrição.</Text>}
          </View>
          {admin && <Pressable onPress={() => setEditing(true)} style={styles.save} accessibilityRole="button" accessibilityLabel="Editar o TxillGroup"><Text style={styles.goText}>Editar</Text></Pressable>}
        </View>
        {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
        <FlatList
          data={group.members}
          keyExtractor={(m) => m.username}
          ListHeaderComponent={
            <View>
              <GroupAccessSection group={group} onChanged={onChanged} />
              {admin && (
                <Pressable onPress={() => setAdding(true)} style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
                  <View style={styles.addIcon}><Icon name="user-plus" size={22} color={colors.brand} /></View>
                  <Text style={styles.rowName}>Adicionar pessoas</Text>
                </Pressable>
              )}
              <Text style={styles.members}>{group.members.length} PESSOAS</Text>
            </View>
          }
          renderItem={({ item: m }) => {
            const badge = roleBadge(m.role);
            const mine = m.username === me;
            const actions = memberActions({ myRole: group.myRole, me, member: m });
            return (
              <View style={styles.member}>
                <Pressable onPress={() => { onClose(); router.push(`/u/${m.username}` as never); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }} accessibilityRole="link" accessibilityLabel={`${m.displayName}${mine ? ' (tu)' : ''}, @${m.username}${badge ? `, ${badge}` : ''}`}>
                  <Avatar name={m.displayName} username={m.hasAvatar ? m.username : undefined} size={44} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <NameWithBadge name={m.displayName} who={m} style={styles.rowName}>{mine ? <Text style={[styles.rowName, { flexShrink: 0 }]}>(tu)</Text> : null}</NameWithBadge>
                    <Text style={styles.rowSub} numberOfLines={1}>@{m.username}</Text>
                  </View>
                </Pressable>
                {badge && <View style={styles.adminTag} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden><Text style={styles.adminText}>{badge}</Text></View>}
                {actions.length > 0 && (
                  <Pressable disabled={busy} onPress={() => { setErr(''); setNotice(''); setMenuFor(m.username); }} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Opções para ${m.displayName}`} style={({ pressed }) => [styles.kick, pressed && { backgroundColor: colors.zinc100 }]}>
                    <Icon name="more" size={20} color={colors.zinc600} />
                  </Pressable>
                )}
              </View>
            );
          }}
          ListFooterComponent={
            <Pressable onPress={() => setConfirm(true)} style={({ pressed }) => [styles.exit, pressed && { backgroundColor: '#fef2f2' }]} accessibilityRole="button">
              <Icon name="logout" size={18} color="#b91c1c" />
              <Text style={styles.exitText}>Sair do TxillGroup</Text>
            </Pressable>
          }
        />
      </View>
      {menuMember && (
        <MemberMenuSheet
          member={menuMember}
          actions={memberActions({ myRole: group.myRole, me, member: menuMember })}
          note={menuMember.username === me ? stepDownNote(admins) : null}
          onRole={(a) => setRole(menuMember, a)}
          onRemove={() => { setKick(menuMember); setMenuFor(null); }}
          onClose={() => setMenuFor(null)}
        />
      )}
      {kick && (
        <ConfirmSheet
          title={`Tirar ${kick.displayName} do TxillGroup?`}
          lines={[`${kick.displayName} deixa de receber as mensagens de “${group.name}”. ${accessOf(group) === 'public' ? 'Como o grupo é público, pode voltar a entrar.' : 'Só volta se alguém o adicionar.'}`]}
          confirmLabel="Tirar do TxillGroup"
          danger
          onConfirm={async () => {
            await gruposApi.remove(group.id, kick.username);
            done(roleDoneText('remove', kick.displayName));
            onChanged();
          }}
          onClose={() => setKick(null)}
        />
      )}
    </Sheet>
  );
}

/** O menu de uma pessoa (só para administradores): mudar o papel e tirar do grupo. Erros (ex.: o último administrador) ficam à vista. */
function MemberMenuSheet({ member, actions, note, onRole, onRemove, onClose }: { member: GroupMember; actions: MemberAction[]; note: string | null; onRole: (a: MemberAction) => Promise<void>; onRemove: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  async function press(a: MemberAction) {
    if (a.id === 'remove') return onRemove();
    setBusy(a.id);
    setErr('');
    try {
      await onRole(a);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Sheet title={member.displayName} onClose={() => { if (!busy) onClose(); }}>
      <View style={{ paddingHorizontal: 20, gap: 6 }}>
        <Text style={styles.menuSub}>@{member.username}{member.role === 'admin' ? ' · Administrador' : ''}</Text>
        {actions.map((a) => (
          <Pressable
            key={a.id}
            disabled={!!busy}
            onPress={() => void press(a)}
            style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: a.destructive ? '#fef2f2' : colors.zinc100 }, !!busy && busy !== a.id && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!busy, busy: busy === a.id }}
          >
            <Icon name={a.id === 'remove' ? 'x' : a.id === 'promote' ? 'shield' : 'user'} size={20} color={a.destructive ? '#b91c1c' : colors.zinc700} />
            <Text style={[styles.menuText, a.destructive && { color: '#b91c1c' }]}>{busy === a.id ? 'Um momento…' : a.label}</Text>
          </Pressable>
        ))}
        {note ? <Text style={styles.menuNote}>{note}</Text> : null}
        {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        <Pressable onPress={onClose} disabled={!!busy} style={styles.stay} accessibilityRole="button"><Text style={styles.backText}>Fechar</Text></Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  nameInput: { height: 48, borderRadius: 24, backgroundColor: colors.zinc100, paddingHorizontal: 20, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  chosen: { marginTop: 20, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16 },
  chipName: { width: '100%', textAlign: 'center', fontSize: 12, color: colors.zinc700 },
  count: { marginTop: 16, textAlign: 'center', fontSize: 14, color: colors.zinc500 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 22, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, padding: 0, outlineStyle: 'none' } as object,
  remove: { position: 'absolute', right: -4, top: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.zinc800, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  sugg: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, fontSize: 13, fontWeight: '700', color: colors.zinc500 },
  none: { paddingVertical: 48, textAlign: 'center', color: colors.zinc500 },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 12 },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  rowSub: { fontSize: 14, color: colors.zinc500 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  foot: { borderTopWidth: 1, borderTopColor: colors.zinc100, paddingHorizontal: 16, paddingTop: 12 },
  err: { marginBottom: 8, textAlign: 'center', fontSize: 14, color: colors.red600 },
  go: { flex: 1, height: 48, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  goText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  back: { height: 48, borderRadius: 24, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 16, fontWeight: '600', color: colors.zinc700 },
  hint: { marginTop: 8, textAlign: 'center', fontSize: 12, color: colors.zinc500 },
  confirmText: { marginBottom: 16, fontSize: 16, lineHeight: 22, color: colors.zinc600 },
  leave: { height: 48, borderRadius: 24, backgroundColor: '#b91c1c', alignItems: 'center', justifyContent: 'center' },
  stay: { marginTop: 8, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  save: { height: 48, borderRadius: 24, backgroundColor: colors.brand, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  add: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 4 },
  addIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  members: { paddingHorizontal: 4, paddingTop: 12, paddingBottom: 4, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.zinc500 },
  member: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  adminTag: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 10, paddingVertical: 4 },
  adminText: { fontSize: 12, fontWeight: '700', color: colors.zinc700 },
  notice: { marginBottom: 8, textAlign: 'center', fontSize: 14, color: colors.zinc700 },
  menuSub: { marginBottom: 4, fontSize: 14, color: colors.zinc500 },
  menuRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 12 },
  menuText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  menuNote: { paddingHorizontal: 4, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  kick: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  exit: { marginTop: 12, height: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  exitText: { fontSize: 16, fontWeight: '600', color: '#b91c1c' },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, borderRadius: 20, backgroundColor: colors.zinc100, padding: 12 },
  infoKind: { fontSize: 13, fontWeight: '800', color: colors.brand },
  infoDesc: { marginTop: 2, fontSize: 14, lineHeight: 19, color: colors.zinc700 },
});
