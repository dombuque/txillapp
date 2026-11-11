import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { MusicPicker } from '@/components/MusicPicker';
import { Sheet } from '@/components/Sheet';
import { TrackCard } from '@/components/TrackCard';
import { notesApi, type Note } from '@/lib/api.notes';
import type { Track } from '@/lib/api.music';
import { useAuth } from '@/lib/auth';
import { notesRow } from '@/lib/notesRow';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

const LIMIT = 60;
const trackLine = (n?: Note | null) => (n?.music ? `${n.music.title}${n.music.artist ? ` · ${n.music.artist}` : ''}` : '');

/** O balão da nota, por cima da foto: texto curto em 3 linhas, com o "bico" a apontar para a pessoa. */
function Bubble({ text, dim = false, track = '', cheers = 0 }: { text: string; dim?: boolean; track?: string; cheers?: number }) {
  const tone = dim ? { color: colors.zinc500 } : null;
  return (
    <View style={styles.bubbleWrap}>
      <View style={styles.bubble}>
        {!!text && <Text style={[styles.bubbleText, tone]} numberOfLines={track ? 2 : 3}>{text}</Text>}
        {!!track && (
          <View style={[styles.trackRow, !!text && { marginTop: 2 }]}>
            <Icon name="music" size={11} color={text ? colors.zinc500 : dim ? colors.zinc500 : colors.zinc800} />
            <Text style={[text ? styles.trackSmall : styles.bubbleText, { flexShrink: 1 }, !text && tone]} numberOfLines={text ? 1 : 3}>{track}</Text>
          </View>
        )}
      </View>
      <View style={styles.tail} />
      {cheers > 0 && (
        <View style={styles.cheers} accessibilityLabel={`${cheers} ${cheers === 1 ? 'brinde' : 'brindes'}`}>
          <Icon name="cheers" size={14} color={colors.amber600} />
          {cheers > 1 && <Text style={styles.cheersN}>{cheers}</Text>}
        </View>
      )}
    </View>
  );
}

function Field({ children }: { children: ReactNode }) {
  return <View style={{ paddingHorizontal: 24 }}>{children}</View>;
}

/**
 * Notas, como no Instagram: uma frase de até 60 caracteres por cima da tua foto, durante 24 horas.
 * Só as vêem os teus seguidores. Não se editam. Tocar numa nota de outra pessoa deixa-te responder.
 * Depois das notas vêm as pessoas com quem já conversaste, mesmo sem nota (tocar abre a conversa) — ver lib/notesRow.ts.
 */
export function NotesStrip() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['notes'], queryFn: notesApi.list, staleTime: 60_000, refetchInterval: 120_000 });
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<Note | null>(null);
  const router = useRouter();
  const mine = q.data?.mine ?? null;
  const row = notesRow(q.data?.items, q.data?.people, user?.username);
  const names = row.map((e) => (e.kind === 'note' ? e.note : e.person)).filter((p) => p.hasAvatar).map((p) => p.username);
  const presence = useQuery({ queryKey: ['notes-online', names.join(',')], queryFn: () => notesApi.online(names), enabled: names.length > 0, refetchInterval: 30_000, staleTime: 15_000 });
  const online = new Set((presence.data?.online ?? []).map((x) => x.toLowerCase()));
  if (!user) return null;

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripIn} accessibilityLabel="Notas">
        <Pressable onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel={mine ? 'A tua nota' : 'Deixar uma nota'} style={({ pressed }) => [styles.item, pressed && { transform: [{ scale: 0.95 }] }]}>
          <View style={styles.bubbleSlot}><Bubble text={mine ? mine.body : 'Deixa uma nota'} dim={!mine} track={trackLine(mine)} cheers={mine?.cheers ?? 0} /></View>
          <View>
            <Avatar name={user.displayName} username={user.username} size={64} />
            {!mine && <View style={styles.plus}><Icon name="plus" size={14} strokeWidth={3} color="#fff" /></View>}
          </View>
          <Text style={styles.label} numberOfLines={1}>A tua nota</Text>
        </Pressable>
        {row.map((e) => {
          if (e.kind === 'note') {
            const n = e.note;
            return (
              <Pressable key={e.key} onPress={() => setViewing(n)} accessibilityRole="button" accessibilityLabel={`Nota de ${n.displayName}: ${n.body}`} style={({ pressed }) => [styles.item, pressed && { transform: [{ scale: 0.95 }] }]}>
                <View style={styles.bubbleSlot}><Bubble text={n.body} track={trackLine(n)} cheers={n.cheered ? 1 : 0} /></View>
                <View>
                  <Avatar name={n.displayName} username={n.hasAvatar ? n.username : undefined} size={64} />
                  {n.hasAvatar && online.has(n.username.toLowerCase()) && <View style={styles.online} accessibilityLabel="Online" />}
                </View>
                <Text style={styles.label} numberOfLines={1}>{n.displayName.split(' ')[0]}</Text>
              </Pressable>
            );
          }
          // Alguém das minhas conversas, sem nota: sem balão (mas com o lugar dele, para as fotos ficarem todas alinhadas).
          const p = e.person;
          return (
            <Pressable key={e.key} onPress={() => router.push(`/messages/${p.username}` as never)} accessibilityRole="button" accessibilityLabel={`Conversa com ${p.displayName}`} style={({ pressed }) => [styles.item, pressed && { transform: [{ scale: 0.95 }] }]}>
              <View style={styles.bubbleSlot} />
              <View>
                <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={64} />
                {p.hasAvatar && online.has(p.username.toLowerCase()) && <View style={styles.online} accessibilityLabel="Online" />}
              </View>
              <Text style={styles.label} numberOfLines={1}>{p.displayName.split(' ')[0]}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {editing && <NoteEditor current={mine} onClose={() => setEditing(false)} />}
      {viewing && <NoteView note={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** Publicar a minha nota, ou apagá-la. Não se edita: apaga-se e escreve-se outra. */
function NoteEditor({ current, onClose }: { current: Note | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [music, setMusic] = useState<Track | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(job: () => Promise<unknown>) {
    setBusy(true);
    setErr('');
    try {
      await job();
      await qc.invalidateQueries({ queryKey: ['notes'] });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  const cantPost = busy || (!body.trim() && !music);

  return (
    <>
      <Sheet title="A tua nota" onClose={onClose}>
        <Field>
          {current ? (
            <>
              {!!current.body && <Text style={styles.big}>{current.body}</Text>}
              {current.music && <TrackCard track={current.music} autoplay playNow />}
              {!!current.cheers && (
                <View style={styles.cheerRow}><Icon name="cheers" size={18} color={colors.zinc700} /><Text style={styles.cheerRowText}>{current.cheers} {current.cheers === 1 ? 'brinde' : 'brindes'}</Text></View>
              )}
              <Text style={styles.hint}>{timeAgo(current.createdAt)} · visível para os teus seguidores. Uma nota não se edita: apaga-a para publicar outra.</Text>
              {!!err && <Text accessibilityRole="alert" style={styles.err}>{err}</Text>}
              <Pressable disabled={busy} onPress={() => setConfirmDelete(true)} style={({ pressed }) => [styles.ghostBtn, { marginTop: 12 }, pressed && { backgroundColor: '#fef2f2' }]}><Text style={[styles.ghostText, { color: '#b91c1c' }]}>Apagar nota</Text></Pressable>
            </>
          ) : (
            <>
              <TextInput value={body} onChangeText={(t) => setBody(t.replace(/\n/g, ' ').slice(0, LIMIT))} multiline autoFocus placeholder="O que se passa?" placeholderTextColor={colors.zinc500} accessibilityLabel="Nota" style={[styles.field, { height: 80, textAlignVertical: 'top' }]} />
              <Text style={[styles.count, body.length >= LIMIT && { color: colors.brand }]}>{body.length}/{LIMIT}</Text>
              {music ? (
                <View>
                  <TrackCard track={music} />
                  <Pressable onPress={() => setMusic(null)} accessibilityLabel="Tirar a música" style={styles.drop}><Icon name="x" size={16} color={colors.zinc600} /></Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setPicking(true)} style={({ pressed }) => [styles.musicBtn, pressed && { transform: [{ scale: 0.98 }] }]}><Icon name="music" size={18} color={colors.zinc800} /><Text style={styles.musicText}>Adicionar música</Text></Pressable>
              )}
              <Text style={[styles.hint, { textAlign: 'left' }]}>Fica 24 horas por cima da tua foto, para os teus seguidores. Quem vê pode responder-te por mensagem.</Text>
              {!!err && <Text accessibilityRole="alert" style={styles.err}>{err}</Text>}
              <Pressable disabled={cantPost} onPress={() => void run(() => notesApi.set(body.trim(), music))} style={[styles.primary, { marginTop: 12 }, cantPost && { opacity: 0.4 }]}><Text style={styles.primaryText}>Partilhar nota</Text></Pressable>
            </>
          )}
        </Field>
      </Sheet>
      {picking && <MusicPicker hint={body} onPick={(t) => { setMusic(t); setPicking(false); }} onClose={() => setPicking(false)} />}
      {confirmDelete && (
        <Sheet title="Apagar a nota?" onClose={() => setConfirmDelete(false)}>
          <Field>
            <Text style={{ marginBottom: 16, fontSize: 16, color: colors.zinc600 }}>A nota desaparece já para toda a gente. Podes escrever outra quando quiseres.</Text>
            <Pressable disabled={busy} onPress={() => void run(() => notesApi.remove())} style={[styles.primary, { backgroundColor: '#b91c1c' }, busy && { opacity: 0.5 }]}><Text style={styles.primaryText}>Apagar</Text></Pressable>
            <Pressable onPress={() => setConfirmDelete(false)} style={({ pressed }) => [styles.ghostBtn, { marginTop: 8 }, pressed && { backgroundColor: colors.zinc100 }]}><Text style={styles.ghostText}>Cancelar</Text></Pressable>
          </Field>
        </Sheet>
      )}
    </>
  );
}

/** A nota de outra pessoa: ler, brindar e responder (a resposta vai como mensagem). */
function NoteView({ note, onClose }: { note: Note; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cheered, setCheered] = useState(!!note.cheered);
  const pop = useRef(new Animated.Value(1)).current;

  async function cheer() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setCheered((c) => !c);
    Animated.sequence([Animated.timing(pop, { toValue: 1.3, duration: 150, useNativeDriver: true }), Animated.timing(pop, { toValue: 1, duration: 250, useNativeDriver: true })]).start();
    try {
      const r = await notesApi.cheer(note.username);
      setCheered(r.cheered);
      void qc.invalidateQueries({ queryKey: ['notes'] });
    } catch (e) {
      setCheered((c) => !c);
      setErr((e as Error).message);
    }
  }

  async function reply() {
    if (!text.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await notesApi.reply(note.username, text.trim());
      onClose();
      router.push(`/messages/${note.username}` as never);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  const cantSend = busy || !text.trim();

  return (
    <Sheet title={note.displayName} onClose={onClose}>
      <Field>
        <View style={{ alignItems: 'center' }}>
          <Avatar name={note.displayName} username={note.hasAvatar ? note.username : undefined} size={72} />
          {!!note.body && <Text style={[styles.big, { marginTop: 12 }]}>{note.body}</Text>}
          {note.music && <View style={{ width: '100%' }}><TrackCard track={note.music} autoplay playNow /></View>}
          <Text style={[styles.hint, { marginTop: 6 }]}>{timeAgo(note.createdAt)}</Text>
        </View>
        <Pressable onPress={() => void cheer()} accessibilityRole="button" accessibilityState={{ selected: cheered }} style={[styles.cheerBtn, { backgroundColor: cheered ? '#fef3c7' : colors.zinc100 }]}>
          <Animated.View style={{ transform: [{ scale: pop }] }}><Icon name="cheers" size={20} color={cheered ? '#92400e' : colors.zinc800} /></Animated.View>
          <Text style={[styles.cheerBtnText, { color: cheered ? '#92400e' : colors.zinc800 }]}>{cheered ? 'Brindou' : 'Brindar'}</Text>
        </Pressable>
        <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
          <TextInput value={text} onChangeText={setText} maxLength={400} placeholder="Responder à nota…" placeholderTextColor={colors.zinc500} accessibilityLabel="Responder à nota" returnKeyType="send" onSubmitEditing={() => void reply()} style={[styles.field, { flex: 1 }]} />
          <Pressable disabled={cantSend} onPress={() => void reply()} style={[styles.send, cantSend && { opacity: 0.4 }]}><Text style={styles.primaryText}>Enviar</Text></Pressable>
        </View>
        {!!err && <Text accessibilityRole="alert" style={styles.err}>{err}</Text>}
        <Pressable onPress={() => { onClose(); router.push(`/messages/${note.username}` as never); }} style={({ pressed }) => [styles.ghostBtn, { marginTop: 8, height: 44 }, pressed && { backgroundColor: colors.zinc100 }]}><Text style={styles.ghostText}>Abrir a conversa</Text></Pressable>
      </Field>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  strip: { marginHorizontal: -16, flexGrow: 0 },
  stripIn: { gap: 16, paddingHorizontal: 16, paddingBottom: 8, paddingTop: 12 },
  item: { width: 84, alignItems: 'center' },
  bubbleSlot: { height: 54, justifyContent: 'flex-end', alignItems: 'center' },
  bubbleWrap: { marginBottom: 6, maxWidth: 84 },
  bubble: { maxWidth: 84, borderRadius: 14, backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: colors.zinc100, boxShadow: '0 1px 6px rgba(0,0,0,0.18)' } as object,
  bubbleText: { fontSize: 11, fontWeight: '500', lineHeight: 12.65, textAlign: 'center', color: colors.zinc800 },
  trackRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  trackSmall: { fontSize: 10, lineHeight: 12, textAlign: 'center', color: colors.zinc500 },
  tail: { position: 'absolute', bottom: -4, left: '50%', marginLeft: -5, width: 10, height: 10, backgroundColor: '#fff', transform: [{ rotate: '45deg' }] },
  cheers: { position: 'absolute', right: -8, top: -10, height: 22, minWidth: 22, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#fef3c7', boxShadow: '0 1px 5px rgba(0,0,0,0.25)' } as object,
  cheersN: { fontSize: 10, fontWeight: '700', color: colors.amber600 },
  plus: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  online: { position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: '#10b981' },
  label: { marginTop: 4, width: '100%', textAlign: 'center', fontSize: 12, color: colors.zinc600 },
  big: { alignSelf: 'center', maxWidth: 320, borderRadius: 18, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12, textAlign: 'center', fontSize: 17, fontWeight: '500', lineHeight: 23, color: colors.zinc900, overflow: 'hidden' },
  hint: { marginTop: 8, textAlign: 'center', fontSize: 12, color: colors.zinc500 },
  err: { marginTop: 8, textAlign: 'center', fontSize: 14, color: colors.red600 },
  field: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  count: { marginTop: 4, textAlign: 'right', fontSize: 12, color: colors.zinc500 },
  musicBtn: { marginTop: 8, height: 44, borderRadius: 999, backgroundColor: colors.zinc100, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  musicText: { fontSize: 16, fontWeight: '600', color: colors.zinc800 },
  drop: { position: 'absolute', right: 8, top: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.zinc200, alignItems: 'center', justifyContent: 'center' },
  primary: { height: 48, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  ghostBtn: { height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 16, fontWeight: '600', color: colors.zinc700 },
  cheerRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cheerRowText: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },
  cheerBtn: { alignSelf: 'center', marginTop: 16, height: 44, paddingHorizontal: 24, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 8 },
  cheerBtnText: { fontSize: 16, fontWeight: '600' },
  send: { height: 50, paddingHorizontal: 20, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
