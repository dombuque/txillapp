import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { NameWithBadge } from '@/components/NameWithBadge';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Button } from '@/components/ui/Button';
import { ApiError, api, type Badged, type Gender } from '@/lib/api';
import { colors } from '@/lib/theme';
import { GENDERS } from './options';
import { settingsStyles as s } from './SettingRow';

/** As folhas das Definições (as mesmas do ecrã único de antes, agora partilhadas pelos ecrãs de cada grupo). */

/** Uma pessoa com um botão (Mostrar, Desbloquear): um toque só enquanto trata e, se falhar, diz porquê. */
export function PersonRow({ username, displayName, who, action, onAction }: { username: string; displayName: string; /** O selo de verificado da pessoa. */ who?: Badged; action: string; onAction: () => Promise<unknown> | void }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      await onAction();
    } catch (e) {
      Alert.alert('Não deu', (e as Error).message || 'Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.person}>
      <Avatar name={displayName} username={username} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <NameWithBadge name={displayName} who={who} style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} />
        <Text style={{ fontSize: 14, color: colors.zinc600 }} numberOfLines={1}>@{username}</Text>
      </View>
      <Button label={action} kind="secondary" size="sm" onPress={() => void run()} disabled={busy} loading={busy} accessibilityLabel={`${action} @${username}`} />
    </View>
  );
}

/** Como te identificas: escolhe-se uma vez. */
export function GenderSheet({ value, onPick, onClose }: { value: Gender | null | undefined; onPick: (g: Gender) => void; onClose: () => void }) {
  return (
    <Sheet title="Como te identificas?" onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingBottom: 8 }} accessibilityRole="radiogroup">
        {GENDERS.map((g) => {
          const on = value === g.value;
          return (
            <Pressable key={g.value} onPress={() => { onPick(g.value); onClose(); }} style={[st.gender, on && { borderColor: colors.brand, backgroundColor: colors.rose50 }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: on ? colors.brand : colors.zinc800 }}>{g.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

/** Trocar para outra conta guardada neste aparelho. */
export function SwitchAccountSheet({ others, onPick, onClose }: { others: { username: string; displayName: string }[]; onPick: (username: string) => void; onClose: () => void }) {
  return (
    <Sheet title="Trocar de conta" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        {others.map((a) => (
          <Pressable key={a.username} onPress={() => { onClose(); onPick(a.username); }} style={[s.person, { minHeight: 56 }]} accessibilityRole="button" accessibilityLabel={`Trocar para @${a.username}`}>
            <Avatar name={a.displayName} username={a.username} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{a.displayName}</Text>
              <Text style={{ fontSize: 14, color: colors.zinc600 }} numberOfLines={1}>@{a.username}</Text>
            </View>
            <Icon name="chevron-right" size={18} color="#a1a1aa" />
          </Pressable>
        ))}
        <Text style={{ marginTop: 8, fontSize: 13, color: colors.zinc500, textAlign: 'center' }}>Dica: toca duas vezes no perfil, na barra de baixo, para trocar.</Text>
      </View>
    </Sheet>
  );
}

/**
 * Sair leva uns segundos (tirar do mapa, desligar as notificações deste telemóvel, fechar a sessão): enquanto isso o botão
 * mostra que está a sair e não aceita outro toque (antes podia lançar várias saídas seguidas e parecia não fazer nada).
 */
export function LogoutSheet({ onConfirm, onClose }: { onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await onConfirm();
    } catch {
      setErr('Não consegui terminar a sessão. Tenta outra vez.');
      setBusy(false);
    }
  }
  return (
    <Sheet title="Terminar sessão" onClose={busy ? () => undefined : onClose}>
      <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
        <Text style={{ fontSize: 18, paddingVertical: 8, color: colors.zinc900 }}>Já vais?</Text>
        <Text style={{ color: colors.zinc600, marginBottom: 20, fontSize: 16 }}>Vais precisar de entrar outra vez para voltar.</Text>
        {err ? <Text style={{ color: colors.danger, marginBottom: 12, fontSize: 14 }} accessibilityLiveRegion="polite">{err}</Text> : null}
        <Button label="Sim, sair" onPress={() => void confirm()} disabled={busy} loading={busy} />
        <Button label="Fico por aqui" kind="secondary" onPress={onClose} disabled={busy} style={{ marginTop: 12 }} />
      </View>
    </Sheet>
  );
}

/** Pessoas a quem escondo os meus mimos. */
export function HiddenSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['story-settings'], queryFn: api.storySettings });
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  async function add() {
    const u = name.trim().replace(/^@/, '');
    if (!u) return;
    setErr('');
    try {
      qc.setQueryData(['story-settings'], await api.hideStoryFrom(u));
      setName('');
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 404 ? 'Esse utilizador não existe' : (x as Error).message);
    }
  }
  return (
    <Sheet title="Esconder mimo de…" onClose={onClose} full>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ marginBottom: 12, fontSize: 14, color: colors.zinc600 }}>Estas pessoas deixam de ver os teus mimos, sem serem avisadas.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={name} onChangeText={setName} placeholder="@utilizador" placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => void add()} style={[s.input, { flex: 1 }]} accessibilityLabel="Utilizador" />
          <Button label="Esconder" size="md" onPress={() => void add()} disabled={!name.trim()} style={{ alignSelf: 'center' }} />
        </View>
        <Text style={{ minHeight: 20, paddingTop: 4, fontSize: 14, color: colors.danger }}>{err}</Text>
        {q.data?.hidden.length === 0 && <Text style={s.none}>Ninguém escondido</Text>}
        {q.data?.hidden.map((h) => <PersonRow key={h.username} username={h.username} displayName={h.displayName} who={h} action="Mostrar" onAction={async () => qc.setQueryData(['story-settings'], await api.unhideStoryFrom(h.username))} />)}
      </ScrollView>
    </Sheet>
  );
}

export function BlockedSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['blocked'], queryFn: api.blocked });
  return (
    <Sheet title="Contas bloqueadas" onClose={onClose} full>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ marginBottom: 12, fontSize: 14, color: colors.zinc600 }}>Quem bloqueias não vê o teu conteúdo, não te pode seguir nem interagir contigo. Também deixam de ver, no mapa ou de fora, os TxillGroups onde o outro está, e não podem pedir nem entrar neles. A pessoa é avisada de que foi bloqueada.</Text>
        {q.data?.length === 0 && <Text style={s.none}>Não bloqueaste ninguém</Text>}
        {q.data?.map((b) => <PersonRow key={b.username} username={b.username} displayName={b.displayName} who={b} action="Desbloquear" onAction={async () => { qc.setQueryData(['blocked'], await api.unblock(b.username)); void qc.invalidateQueries({ queryKey: ['profile'] }); }} />)}
      </ScrollView>
    </Sheet>
  );
}

export function PasswordSheet({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const nextRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const againRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  async function submit() {
    if (busy || !cur || !next) return;
    if (next.length < 10) return setErr('A nova senha precisa de pelo menos 10 caracteres');
    if (next !== again) return setErr('As duas senhas novas não são iguais');
    setBusy(true);
    setErr('');
    try {
      await api.changePassword(cur, next);
      setOk(true);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (ok) {
    return (
      <Sheet title="Senha alterada" onClose={onClose}>
        <View style={{ paddingHorizontal: 20 }}>
          <Text style={{ color: colors.zinc700, paddingVertical: 12, fontSize: 16 }}>As sessões nos outros dispositivos foram terminadas.</Text>
          <Button label="Feito" onPress={onClose} />
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet title="Alterar senha" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        {/* O "seguinte" do teclado passa de campo em campo; no último, "ir" muda a senha. */}
        <TextInput value={cur} onChangeText={(t) => { setCur(t); setErr(''); }} placeholder="Senha atual" placeholderTextColor={colors.zinc500} secureTextEntry autoCapitalize="none" autoComplete="current-password" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => nextRef.current?.focus()} style={s.input} accessibilityLabel="Senha atual" />
        <TextInput ref={nextRef} value={next} onChangeText={(t) => { setNext(t); setErr(''); }} placeholder="Nova senha (mínimo 10 caracteres)" placeholderTextColor={colors.zinc500} secureTextEntry autoCapitalize="none" autoComplete="new-password" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => againRef.current?.focus()} style={s.input} accessibilityLabel="Nova senha" />
        <TextInput ref={againRef} value={again} onChangeText={(t) => { setAgain(t); setErr(''); }} placeholder="Repete a nova senha" placeholderTextColor={colors.zinc500} secureTextEntry autoCapitalize="none" autoComplete="new-password" returnKeyType="go" onSubmitEditing={() => void submit()} style={s.input} accessibilityLabel="Repete a nova senha" />
        <Text style={{ minHeight: 20, fontSize: 14, color: colors.danger }} accessibilityLiveRegion="polite">{err}</Text>
        <Button label="Alterar senha" onPress={() => void submit()} disabled={busy || !cur || !next} loading={busy} />
      </View>
    </Sheet>
  );
}

export function DeleteSheet({ username, onClose, onDeleted }: { username: string; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const can = confirm.trim().replace(/^@/, '').toLowerCase() === username.toLowerCase();
  async function submit() {
    if (busy || !can) return;
    setBusy(true);
    setErr('');
    try {
      await api.deleteAccount(confirm.trim(), password || undefined);
      onDeleted();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet title="Eliminar conta" onClose={onClose} full>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 12 }}>
        <View style={{ borderRadius: 16, backgroundColor: colors.dangerSoft, padding: 16 }}>
          <Text style={{ fontWeight: '700', color: '#7f1d1d', fontSize: 14 }}>Isto não se desfaz.</Text>
          {['O teu nome, @, bio, foto e email são apagados.', 'Publicações, fotos, mimos, conversas, chamadas, seguidores e notificações são apagados.', 'Também saem check-ins, músicas favoritas, aparelhos, locais que segues, as tuas respostas e votos nos TxillGroups, os pedidos para entrar em grupos e tudo o que é do mapa.', 'Sais dos teus TxillGroups. Os locais que criaste passam para o administrador mais antigo; sem ele, deixam de aparecer.', 'Os teus comentários (também em posts de outras pessoas) e as mensagens que enviaste nos TxillGroups são apagados.', 'Os movimentos de vibes ficam registados sem dados pessoais.'].map((t) => <Text key={t} style={{ marginTop: 4, fontSize: 14, lineHeight: 20, color: '#7f1d1d' }}>• {t}</Text>)}
        </View>
        <TextInput value={confirm} onChangeText={setConfirm} placeholder={`Escreve @${username} para confirmar`} placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} style={s.input} accessibilityLabel="Confirmar o teu @" />
        <TextInput value={password} onChangeText={setPassword} placeholder="A tua senha (se a conta tiver)" placeholderTextColor={colors.zinc500} secureTextEntry autoComplete="current-password" style={s.input} accessibilityLabel="Senha" />
        <Text style={{ minHeight: 20, fontSize: 14, color: colors.danger }} accessibilityLiveRegion="polite">{err}</Text>
        <Button label="Eliminar a minha conta" kind="dangerSolid" onPress={() => void submit()} disabled={busy || !can} loading={busy} />
        <Button label="Cancelar" kind="secondary" onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  gender: { flex: 1, minHeight: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, backgroundColor: colors.white },
});
