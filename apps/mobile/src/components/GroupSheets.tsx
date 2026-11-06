import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { gruposApi, type GroupThread } from '@/lib/api.grupos';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

interface Person { username: string; displayName: string; hasAvatar: boolean }

/**
 * Nova conversa (igual ao NewChat do site): procura uma pessoa e conversa, ou escolhe duas ou mais para criar um grupo
 * (com nome). Com `addTo`, serve para adicionar pessoas a um grupo que já existe.
 */
export function NewChatSheet({ onClose, addTo }: { onClose: () => void; addTo?: { groupId: string; have: string[]; onAdded: () => void } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const recent = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, staleTime: 30_000 });
  const term = text.trim().replace(/^@/, '');
  const search = useQuery({ queryKey: ['mentionable', term], queryFn: () => api.mentionable(term), enabled: term.length >= 1, staleTime: 30_000 });
  const have = new Set((addTo?.have ?? []).map((u) => u.toLowerCase()));

  const rows: Person[] = (term ? search.data ?? [] : (recent.data ?? []).map((c) => ({ username: c.username, displayName: c.displayName, hasAvatar: c.hasAvatar }))).filter((p) => !have.has(p.username.toLowerCase()));
  const isPicked = (u: string) => picked.some((p) => p.username === u);
  const toggle = (p: Person) => setPicked((l) => (isPicked(p.username) ? l.filter((x) => x.username !== p.username) : [...l, p]));

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
    if (picked.length === 1) {
      onClose();
      return router.push(`/messages/${picked[0].username}` as never);
    }
    if (!naming) return setNaming(true);
    if (!name.trim()) return setErr('Dá um nome ao grupo');
    setBusy(true);
    try {
      const r = await gruposApi.create(name.trim(), picked.map((p) => p.username));
      void qc.invalidateQueries({ queryKey: ['chat-groups'] });
      onClose();
      router.push(`/messages/g/${r.id}` as never);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const label = addTo ? `Adicionar ${picked.length || ''}`.trim() : picked.length === 1 ? 'Conversar' : picked.length > 1 ? (naming ? 'Criar grupo' : 'Seguinte') : 'Escolhe pessoas';
  const title = addTo ? 'Adicionar ao grupo' : naming ? 'Nome do grupo' : 'Nova conversa';

  return (
    <Sheet title={title} onClose={onClose} full plain>
      <Text style={{ textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.zinc900, paddingHorizontal: 16, paddingBottom: 8 }}>{title}</Text>
      {naming ? (
        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          <TextInput value={name} onChangeText={setName} maxLength={40} autoFocus placeholder="Ex.: Malta da Polana" placeholderTextColor={colors.zinc500} accessibilityLabel="Nome do grupo" style={styles.nameInput} />
          <View style={styles.chosen}>
            {picked.map((p) => (
              <View key={p.username} style={{ width: 64, alignItems: 'center', gap: 4 }}>
                <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={52} />
                <Text style={styles.chipName} numberOfLines={1}>{p.displayName.split(' ')[0]}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.count}>{picked.length + 1} pessoas, contigo.</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16 }}>
            <View style={styles.search}>
              <Icon name="search" size={18} color={colors.zinc500} />
              <TextInput value={text} onChangeText={setText} placeholder="Procurar" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar pessoas" style={styles.searchInput} autoCapitalize="none" />
            </View>
            {picked.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, flexGrow: 0 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
                {picked.map((p) => (
                  <Pressable key={p.username} onPress={() => toggle(p)} accessibilityLabel={`Tirar ${p.displayName}`} style={{ width: 60, alignItems: 'center', gap: 4 }}>
                    <View>
                      <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={52} />
                      <View style={styles.remove}><Icon name="x" size={12} strokeWidth={3} color="#fff" /></View>
                    </View>
                    <Text style={styles.chipName} numberOfLines={1}>{p.displayName.split(' ')[0]}</Text>
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
                    <Text style={styles.rowName} numberOfLines={1}>{p.displayName}</Text>
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
          {naming && <Pressable onPress={() => setNaming(false)} style={styles.back}><Text style={styles.backText}>Voltar</Text></Pressable>}
          <Pressable onPress={() => void go()} disabled={busy || picked.length === 0} style={[styles.go, (busy || picked.length === 0) && { opacity: 0.4 }]} accessibilityRole="button">
            <Text style={styles.goText}>{busy ? 'A criar…' : label}</Text>
          </Pressable>
        </View>
        {!addTo && !naming && picked.length === 1 && <Text style={styles.hint}>Escolhe mais pessoas para criar um grupo.</Text>}
      </View>
    </Sheet>
  );
}

/** Membros de um grupo: quem administra muda o nome, adiciona e tira pessoas; qualquer pessoa pode sair. */
export function GroupInfoSheet({ group, onClose, onChanged, onLeft }: { group: GroupThread['group']; onClose: () => void; onChanged: () => void; onLeft: () => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const admin = group.myRole === 'admin';
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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

  if (adding) return <NewChatSheet onClose={() => setAdding(false)} addTo={{ groupId: group.id, have: group.members.map((m) => m.username), onAdded: onChanged }} />;

  if (confirm) {
    return (
      <Sheet title="Sair do grupo?" onClose={() => setConfirm(false)}>
        <View style={{ paddingHorizontal: 24 }}>
          <Text style={styles.confirmText}>Deixas de receber as mensagens de “{group.name}”. Só voltas se alguém te adicionar.</Text>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Pressable disabled={busy} onPress={() => void run(() => gruposApi.remove(group.id, user!.username), onLeft)} style={[styles.leave, busy && { opacity: 0.5 }]}><Text style={styles.goText}>Sair do grupo</Text></Pressable>
          <Pressable onPress={() => setConfirm(false)} style={styles.stay}><Text style={styles.backText}>Ficar</Text></Pressable>
        </View>
      </Sheet>
    );
  }

  const changed = name.trim() && name.trim() !== group.name;
  return (
    <Sheet title={group.name} onClose={onClose} full>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        {admin && (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <TextInput value={name} onChangeText={setName} maxLength={40} accessibilityLabel="Nome do grupo" style={[styles.nameInput, { flex: 1 }]} />
            <Pressable disabled={busy || !changed} onPress={() => void run(() => gruposApi.rename(group.id, name.trim()))} style={[styles.save, (busy || !changed) && { opacity: 0.4 }]}><Text style={styles.goText}>Guardar</Text></Pressable>
          </View>
        )}
        {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        <FlatList
          data={group.members}
          keyExtractor={(m) => m.username}
          ListHeaderComponent={
            <View>
              {admin && (
                <Pressable onPress={() => setAdding(true)} style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.zinc100 }]}>
                  <View style={styles.addIcon}><Icon name="user-plus" size={22} color={colors.brand} /></View>
                  <Text style={styles.rowName}>Adicionar pessoas</Text>
                </Pressable>
              )}
              <Text style={styles.members}>{group.members.length} PESSOAS</Text>
            </View>
          }
          renderItem={({ item: m }) => (
            <View style={styles.member}>
              <Pressable onPress={() => { onClose(); router.push(`/u/${m.username}` as never); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <Avatar name={m.displayName} username={m.hasAvatar ? m.username : undefined} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{m.displayName}{m.username === user?.username ? ' (tu)' : ''}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>@{m.username}</Text>
                </View>
              </Pressable>
              {m.role === 'admin' && <View style={styles.adminTag}><Text style={styles.adminText}>Admin</Text></View>}
              {admin && m.username !== user?.username && (
                <Pressable disabled={busy} onPress={() => void run(() => gruposApi.remove(group.id, m.username))} accessibilityLabel={`Tirar ${m.displayName} do grupo`} style={styles.kick}><Icon name="x" size={18} color={colors.red600} /></Pressable>
              )}
            </View>
          )}
          ListFooterComponent={
            <Pressable onPress={() => setConfirm(true)} style={({ pressed }) => [styles.exit, pressed && { backgroundColor: '#fef2f2' }]}>
              <Icon name="logout" size={18} color="#b91c1c" />
              <Text style={styles.exitText}>Sair do grupo</Text>
            </Pressable>
          }
        />
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
  kick: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  exit: { marginTop: 12, height: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  exitText: { fontSize: 16, fontWeight: '600', color: '#b91c1c' },
});
