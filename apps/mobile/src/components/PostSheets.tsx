import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, api, type Post } from '@/lib/api';
import { SITE_URL } from '@/lib/config';
import { colors } from '@/lib/theme';
import { BookmarkIcon } from './BookmarkIcon';
import { Icon, type IconName } from './Icon';
import { ReportSheet } from './ReportSheet';
import { Sheet } from './Sheet';

const AMOUNTS = [5, 10, 50, 100];
const OPTIONS: { value: 'silent' | 'private' | 'public'; icon: IconName; title: string; text: string }[] = [
  { value: 'silent', icon: 'eye-off', title: 'Discreto', text: 'Só o presente. Sem mensagem, sem post.' },
  { value: 'private', icon: 'mail', title: 'No privado', text: 'Uma mensagem que só a pessoa vê.' },
  { value: 'public', icon: 'megaphone', title: 'No feed', text: 'Post "presenteou" para a malta ver.' },
];

export const postLink = (post: { code: string; media: { kind?: string }[] }) => `${SITE_URL || 'https://txillapp.com'}/${post.media[0]?.kind === 'video' ? 'r' : 'p'}/${post.code}`;

export function MenuRow({ icon, title, text, onPress, disabled }: { icon: ReactNode; title: string; text: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.zinc100 }, disabled && { opacity: 0.6 }]} accessibilityRole="button">
      <View style={styles.menuIcon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuText}>{text}</Text>
      </View>
    </Pressable>
  );
}

/** Presentear com Txills: discreto, no privado ou no feed (igual ao do site). */
export function GiftSheet({ recipient, postId, preset, onClose }: { recipient: { username: string; displayName: string }; postId?: string; preset?: { amount?: number; note?: string; visibility?: 'silent' | 'private' | 'public' }; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(preset?.amount && AMOUNTS.includes(preset.amount) ? preset.amount : 10);
  const [custom, setCustom] = useState(preset?.amount && !AMOUNTS.includes(preset.amount) ? String(preset.amount) : '');
  const [note, setNote] = useState(preset?.note ?? '');
  const [visibility, setVisibility] = useState<'silent' | 'private' | 'public'>(preset?.visibility ?? 'silent');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ transactionId: string; published: boolean; note: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const key = useRef(newKey());
  const fresh = () => { key.current = newKey(); };
  const name = recipient.displayName;

  async function send() {
    const n = custom ? Number(custom) : amount;
    if (!Number.isInteger(n) || n < 1) return setErr('O número de Txills tem de ser inteiro');
    setBusy(true);
    setErr('');
    try {
      const text = visibility === 'silent' ? '' : note.trim();
      const r = postId ? await api.gift(postId, n, key.current, text, visibility) : await api.giftUser({ toUsername: recipient.username, amount: n, note: text, visibility }, key.current);
      setSent({ transactionId: r.transactionId, published: visibility === 'public', note: text });
      for (const k of ['wallet', 'feed', 'profile-posts', 'chat-thread']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (x) {
      const m = (x as Error).message;
      setErr(m === 'Saldo insuficiente' ? 'Ups, o teu saldo não chega' : x instanceof ApiError && x.status === 404 ? 'Essa pessoa não existe. Confirma o @' : m);
    } finally {
      setBusy(false);
    }
  }
  async function publishNow() {
    if (!sent) return;
    setPublishing(true);
    try {
      await api.publishGift(sent.transactionId, sent.note || undefined);
      setSent({ ...sent, published: true });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  if (sent) {
    return (
      <Sheet title="Presente enviado" onClose={onClose}>
        <View style={{ paddingHorizontal: 24 }}>
          <Text style={styles.sentText}>Mandaste {custom || amount} Txills a {name}! Que generoso</Text>
          {sent.published ? <Text style={[styles.sentText, { color: colors.green700, fontSize: 16 }]}>Já está no feed.</Text> : (
            <Pressable onPress={() => void publishNow()} disabled={publishing} style={styles.ghost}><Text style={styles.ghostText}>{publishing ? 'A publicar…' : 'Publicar no feed agora'}</Text></Pressable>
          )}
          <Text style={styles.err}>{err}</Text>
          <Pressable onPress={onClose} style={styles.primary}><Text style={styles.primaryText}>Feito</Text></Pressable>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Presentear ${name}`} onClose={onClose}>
      <ScrollView style={{ paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
          {AMOUNTS.map((v) => {
            const on = !custom && amount === v;
            return (
              <Pressable key={v} onPress={() => { setAmount(v); setCustom(''); fresh(); }} style={[styles.amount, on ? { borderColor: colors.brand, backgroundColor: colors.brand } : { borderColor: colors.zinc300 }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Text style={[styles.amountText, on && { color: '#fff' }]}>{v}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput value={custom} onChangeText={(t) => { setCustom(t.replace(/\D/g, '')); fresh(); }} keyboardType="number-pad" placeholder="Ou outro valor…" placeholderTextColor={colors.zinc500} style={[styles.field, { marginTop: 8 }]} accessibilityLabel="Outro valor" />
        <View style={styles.opts} accessibilityRole="radiogroup">
          {OPTIONS.map((o) => {
            const on = visibility === o.value;
            return (
              <Pressable key={o.value} onPress={() => { setVisibility(o.value); fresh(); }} style={[styles.opt, on ? { borderColor: colors.brand, backgroundColor: colors.rose50 } : { borderColor: colors.zinc200 }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Icon name={o.icon} size={24} />
                <Text style={styles.optTitle}>{o.title}</Text>
                <Text style={styles.optText}>{o.text}</Text>
              </Pressable>
            );
          })}
        </View>
        {visibility !== 'silent' && (
          <TextInput value={note} onChangeText={(t) => { setNote(t); fresh(); }} maxLength={280} multiline placeholder={visibility === 'private' ? 'Uma mensagem só para a pessoa…' : 'Escreve algo para o post…'} placeholderTextColor={colors.zinc500} style={[styles.field, { marginTop: 16, minHeight: 64, textAlignVertical: 'top' }]} accessibilityLabel="Mensagem" />
        )}
        <Text style={styles.err} accessibilityRole="alert">{err}</Text>
        <Pressable disabled={busy} onPress={() => void send()} style={[styles.primary, { height: 56 }, busy && { opacity: 0.5 }]}><Text style={[styles.primaryText, { fontSize: 18 }]}>{busy ? 'A enviar…' : `Mandar ${custom || amount} Txills`}</Text></Pressable>
        <View style={{ height: 8 }} />
      </ScrollView>
    </Sheet>
  );
}

/** Repostar (tal como está ou com comentário) e desfazer o repost. */
export function RepostSheet({ post, onChange, onClose }: { post: Post; onChange: (p: Partial<Post>) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [quote, setQuote] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
      for (const k of ['feed', 'profile-posts']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={quote ? 'Repostar com comentário' : 'Repostar'} onClose={onClose}>
      <View style={{ paddingHorizontal: 24 }}>
        {quote ? (
          <View style={{ gap: 12 }}>
            <TextInput value={text} onChangeText={setText} maxLength={500} multiline autoFocus placeholder="O que achas?" placeholderTextColor={colors.zinc500} style={[styles.field, { minHeight: 84, textAlignVertical: 'top' }]} accessibilityLabel="Comentário" />
            <Text style={styles.err}>{err}</Text>
            <Pressable disabled={busy || !text.trim()} onPress={() => void run(async () => { await api.repost(post.id, text); onChange({ reposts: post.reposts + 1 }); })} style={[styles.primary, (busy || !text.trim()) && { opacity: 0.5 }]}><Text style={styles.primaryText}>{busy ? 'A publicar…' : 'Publicar'}</Text></Pressable>
            <Pressable onPress={() => setQuote(false)} style={styles.ghost}><Text style={styles.ghostText}>Voltar</Text></Pressable>
          </View>
        ) : (
          <View>
            {post.reposted ? (
              <MenuRow icon={<Icon name="undo" size={22} />} title="Desfazer repost" text="Tira esta publicação do teu perfil." disabled={busy} onPress={() => void run(async () => onChange(await api.unrepost(post.id)))} />
            ) : (
              <MenuRow icon={<Icon name="repeat" size={22} />} title="Repostar" text="Partilha no teu perfil, tal como está." disabled={busy} onPress={() => void run(async () => { await api.repost(post.id); onChange({ reposted: true, reposts: post.reposts + 1 }); })} />
            )}
            <MenuRow icon={<Icon name="pencil" size={22} />} title="Repostar com comentário" text="Acrescenta o que achas ao partilhar." onPress={() => setQuote(true)} />
            {err ? <Text style={styles.err}>{err}</Text> : null}
          </View>
        )}
      </View>
    </Sheet>
  );
}

/** ⋯ da publicação: partilhar, guardar, copiar ligação, editar, apagar (as minhas), não me interessa e denunciar (de outras pessoas). */
export function PostMenuSheet({ post, mine, onClose, onSaved }: { post: Post; mine: boolean; onClose: () => void; onSaved: (saved: boolean) => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState<'menu' | 'edit' | 'report'>('menu');
  const [draft, setDraft] = useState(post.body);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState('');
  const refresh = async (keys: string[]) => { for (const k of keys) await qc.invalidateQueries({ queryKey: [k] }); };

  async function copy() {
    try {
      await Clipboard.setStringAsync(postLink(post));
      setNote('Ligação copiada');
    } catch {
      setNote('Não consegui copiar');
    }
    setTimeout(() => setNote(''), 1800);
  }
  async function share() {
    try {
      await Share.share({ message: postLink(post), url: postLink(post) });
    } catch { /* cancelado */ }
    onClose();
  }
  async function toggleSave() {
    const next = !post.saved;
    await (next ? api.savePost(post.id) : api.unsavePost(post.id)).catch(() => undefined);
    onSaved(next);
    onClose();
    await refresh(['feed', 'profile-posts', 'post', 'reels', 'place', 'saved']);
  }
  async function hide() {
    await api.hideFromFeed(post.id).catch(() => undefined);
    onClose();
    await refresh(['feed']);
  }
  async function clearPlace() {
    await api.updatePost(post.id, { clearLocation: true }).catch(() => undefined);
    onClose();
    await refresh(['feed', 'profile-posts', 'post', 'reels', 'place']);
  }
  async function toggleComments() {
    await api.updatePost(post.id, { commentsOff: !post.commentsOff }).catch(() => undefined);
    onClose();
    await refresh(['feed', 'profile-posts', 'post', 'reels']);
  }
  function confirmDelete() {
    Alert.alert('Apagar a publicação?', 'Deixa de aparecer para toda a gente, incluindo os reposts. Não dá para desfazer.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: async () => { await api.removePost(post.id).catch(() => undefined); onClose(); await refresh(['feed', 'profile-posts', 'post']); } },
    ]);
  }
  async function saveEdit() {
    setSaving(true);
    setEditErr('');
    try {
      await api.updatePost(post.id, { body: draft });
      onClose();
      await refresh(['feed', 'profile-posts', 'post', 'reels']);
    } catch (e) {
      setEditErr((e as Error).message);
    }
    setSaving(false);
  }

  if (view === 'report') return <ReportSheet type="post" id={post.id} onClose={onClose} />;
  if (view === 'edit') {
    return (
      <Sheet title="Editar a publicação" onClose={onClose}>
        <View style={{ paddingHorizontal: 24 }}>
          <TextInput value={draft} onChangeText={setDraft} maxLength={2000} multiline autoFocus style={[styles.field, { minHeight: 120, textAlignVertical: 'top' }]} accessibilityLabel="Texto" />
          <Text style={styles.err}>{editErr}</Text>
          <Pressable onPress={() => void saveEdit()} disabled={saving} style={[styles.primary, saving && { opacity: 0.6 }]}><Text style={styles.primaryText}>Guardar</Text></Pressable>
          <Pressable onPress={onClose} style={styles.cancel}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet title="Publicação" onClose={onClose}>
      <ScrollView style={{ paddingHorizontal: 24 }}>
        <MenuRow icon={<Icon name="share" size={22} />} title="Partilhar" text="No teu status, por ligação ou por outra app." onPress={() => void share()} />
        <MenuRow icon={<BookmarkIcon on={!!post.saved} size={22} color={colors.zinc800} />} title={post.saved ? 'Tirar dos guardados' : 'Guardar'} text="Só tu vês os teus guardados." onPress={() => void toggleSave()} />
        <MenuRow icon={<Icon name="link" size={22} />} title="Copiar ligação" text={note || 'Para partilhares onde quiseres.'} onPress={() => void copy()} />
        {mine && !(post.kind === 'repost' && !post.body) && <MenuRow icon={<Icon name="pencil" size={22} />} title="Editar" text="Muda o texto da publicação." onPress={() => { setDraft(post.body); setView('edit'); }} />}
        {mine && post.locationLabel && <MenuRow icon={<Icon name="map-pin" size={22} />} title="Tirar o local" text="O sítio deixa de aparecer nesta publicação." onPress={() => void clearPlace()} />}
        {mine && <MenuRow icon={<Icon name="comment" size={22} />} title={post.commentsOff ? 'Ativar comentários' : 'Desativar comentários'} text={post.commentsOff ? 'Voltam a poder comentar.' : 'Ninguém pode comentar esta publicação.'} onPress={() => void toggleComments()} />}
        {mine ? (
          <MenuRow icon={<Icon name="trash" size={22} />} title="Apagar" text="Some para toda a gente." onPress={confirmDelete} />
        ) : (
          <>
            <MenuRow icon={<Icon name="eye-off" size={22} />} title="Não me interessa" text="Esta publicação deixa de aparecer no teu feed." onPress={() => void hide()} />
            <MenuRow icon={<Icon name="flag" size={22} />} title="Denunciar" text="Avisa a moderação. A pessoa não sabe." onPress={() => setView('report')} />
          </>
        )}
        <View style={{ height: 8 }} />
      </ScrollView>
    </Sheet>
  );
}

/** Chave única para o pedido (a mesma em retentativas: sem presente duplicado). */
function newKey() {
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const styles = StyleSheet.create({
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 12 },
  menuIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontSize: 17, fontWeight: '600', color: colors.zinc900 },
  menuText: { fontSize: 14, color: colors.zinc600 },
  field: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.zinc900 },
  amount: { flex: 1, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  amountText: { fontWeight: '600', fontSize: 16, color: colors.zinc900 },
  opts: { marginTop: 16, flexDirection: 'row', gap: 8 },
  opt: { flex: 1, borderWidth: 2, borderRadius: 16, padding: 10, alignItems: 'flex-start' },
  optTitle: { marginTop: 2, fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  optText: { marginTop: 2, fontSize: 11, lineHeight: 14, color: colors.zinc600 },
  err: { minHeight: 20, marginTop: 8, textAlign: 'center', fontSize: 14, color: colors.red600 },
  primary: { marginTop: 8, height: 48, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghost: { marginTop: 8, height: 48, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontWeight: '600', fontSize: 16, color: colors.zinc800 },
  cancel: { marginTop: 8, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontWeight: '600', fontSize: 16, color: colors.zinc700 },
  sentText: { paddingVertical: 12, textAlign: 'center', fontSize: 18, color: colors.zinc900 },
});
