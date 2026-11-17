import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, api, isTcheka, type Post } from '@/lib/api';
import { SITE_URL } from '@/lib/config';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { BookmarkIcon } from './BookmarkIcon';
import { QuotedOriginal, THREAD_AVATAR, THREAD_GAP } from './QuoteThread';
import { Icon, type IconName } from './Icon';
import { ReportSheet } from './ReportSheet';
import { Sheet } from './Sheet';
import { ActionRow as MenuRow } from './ui/ActionRow';
import { Button } from './ui/Button';
import { confirm } from '@/lib/confirm';
import { showToast } from '@/lib/toast';
import type { Rect } from '@/lib/desktopKeys';
import { useDesktop } from '@/lib/desktop';
import { linkShare } from '@/lib/shareLink';
import { saveTcheka } from '@/lib/saveTcheka';
import { canDownload } from '@/lib/tchekaDownload';
import { canRepost, REPOST_BLOCKED } from '@/lib/repost';
import { takedownText, takedownTitle } from '@/lib/remix';
import { normTextFont, type TextFontId } from '@/lib/textLayers';
import { formatVibes } from '@/lib/vibes';
import { FontChips } from './FontChips';
import { hideMenuRow } from '@/lib/hidePost';
import { setPostHidden } from '@/lib/hidePostAction';
import { t } from '@/lib/i18n';

const AMOUNTS = [5, 10, 50, 100];
const OPTIONS: { value: 'silent' | 'private' | 'public'; icon: IconName; title: string; text: string }[] = [
  { value: 'silent', icon: 'eye-off', get title() { return t('Discreto'); }, get text() { return t('Só o presente. Sem mensagem, sem post.'); } },
  { value: 'private', icon: 'mail', get title() { return t('No privado'); }, get text() { return t('Uma mensagem que só a pessoa vê.'); } },
  { value: 'public', icon: 'megaphone', get title() { return t('No feed'); }, get text() { return t('Uma publicação no feed para a malta ver.'); } },
];

export const postLink = (post: { code: string; media: { kind?: string }[] }) => `${SITE_URL || 'https://txillapp.com'}/${isTcheka(post) ? 'r' : 'p'}/${post.code}`;

/** A linha de menu passou a ser a partilhada (components/ui/ActionRow); o nome antigo continua a funcionar. */
export { MenuRow };

/** Oferecer vibes: discreto, no privado ou no feed (igual ao do site). */
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
    if (!Number.isInteger(n) || n < 1) return setErr(t('O número de vibes tem de ser inteiro'));
    setBusy(true);
    setErr('');
    try {
      const text = visibility === 'silent' ? '' : note.trim();
      const r = postId ? await api.gift(postId, n, key.current, text, visibility) : await api.giftUser({ toUsername: recipient.username, amount: n, note: text, visibility }, key.current);
      setSent({ transactionId: r.transactionId, published: visibility === 'public', note: text });
      for (const k of ['wallet', 'feed', 'profile-posts', 'chat-thread']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (x) {
      const m = (x as Error).message;
      setErr(m === 'Saldo insuficiente' ? t('Ups, o teu saldo não chega') : x instanceof ApiError && x.status === 404 ? t('Essa pessoa não existe. Confirma o @') : m);
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
      <Sheet title={t('Presente enviado')} onClose={onClose}>
        <View style={{ paddingHorizontal: 24 }}>
          <Text style={styles.sentText}>{t('Ofereceste {vibes} a {name}! Que generoso', { vibes: formatVibes(Number(custom || amount)), name })}</Text>
          {sent.published ? <Text style={[styles.sentText, { color: colors.green700, fontSize: 16 }]}>{t('Já está no feed.')}</Text> : (
            <Button label={t('Publicar no feed agora')} kind="secondary" onPress={() => void publishNow()} loading={publishing} block style={{ marginTop: 8 }} />
          )}
          <Text style={styles.err}>{err}</Text>
          <Button label={t('Feito')} onPress={onClose} block style={{ marginTop: 8 }} />
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet title={t('Oferecer vibes a {name}', { name })} onClose={onClose}>
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
        <TextInput value={custom} onChangeText={(t) => { setCustom(t.replace(/\D/g, '')); fresh(); }} keyboardType="number-pad" placeholder={t('Ou outro valor…')} placeholderTextColor={colors.zinc500} style={[styles.field, { marginTop: 8 }]} accessibilityLabel={t('Outro valor')} />
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
          <TextInput value={note} onChangeText={(t) => { setNote(t); fresh(); }} maxLength={280} multiline placeholder={visibility === 'private' ? t('Uma mensagem só para a pessoa…') : t('Escreve algo para o post…')} placeholderTextColor={colors.zinc500} style={[styles.field, { marginTop: 16, minHeight: 64, textAlignVertical: 'top' }]} accessibilityLabel={t('Mensagem')} />
        )}
        <Text style={styles.err} accessibilityRole="alert">{err}</Text>
        <Button label={t('Oferecer {vibes}', { vibes: formatVibes(Number(custom || amount)) })} icon="gift" onPress={() => void send()} loading={busy} block style={{ marginTop: 8 }} />
        <View style={{ height: 8 }} />
      </ScrollView>
    </Sheet>
  );
}

/** Repostar (tal como está ou com comentário) e desfazer o repost. */
export function RepostSheet({ post, onChange, onClose }: { post: Post; onChange: (p: Partial<Post>) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [quote, setQuote] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // «Deixar repostar as minhas publicações» (lib/repost): sem licença, só fica o «Desfazer repost» (se houver um meu).
  const allowed = canRepost(post);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
      for (const k of ['feed', 'profile-posts']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    } catch (x) {
      // A mensagem da API (ex.: «Quem publicou não deixa repostar as suas publicações.»). Numa publicação em cache sem o
      // `canRepost`, a recusa esconde logo a opção.
      setErr((x as Error).message || t('Não consegui repostar agora. Tenta outra vez.'));
      if (x instanceof ApiError && x.status === 403 && x.message === REPOST_BLOCKED()) onChange({ canRepost: false });
      setBusy(false);
    }
  }

  return (
    <Sheet title={quote ? t('Repostar com comentário') : t('Repostar')} onClose={onClose}>
      <View style={{ paddingHorizontal: 24 }}>
        {quote ? (
          <View style={{ gap: 12 }}>
            {/* O mesmo fio do feed: a original compacta em cima, a linha, e por baixo o que vais escrever. */}
            <View>
              <QuotedOriginal original={post} />
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: THREAD_GAP }}>
                {user ? <Avatar name={user.displayName} username={user.username} size={THREAD_AVATAR} /> : <View style={{ width: THREAD_AVATAR }} />}
                <TextInput value={text} onChangeText={setText} maxLength={500} multiline autoFocus placeholder={t('O que achas?')} placeholderTextColor={colors.zinc500} style={[styles.field, { flex: 1, minHeight: 84, fontSize: 17, lineHeight: 24, textAlignVertical: 'top' }]} accessibilityLabel={t('Comentário')} />
              </View>
            </View>
            <Text style={styles.err}>{err}</Text>
            <Button label={t('Publicar')} onPress={() => void run(async () => { await api.repost(post.id, text); onChange({ reposts: post.reposts + 1 }); })} loading={busy} disabled={!text.trim()} block />
            <Button label={t('Voltar')} kind="ghost" onPress={() => setQuote(false)} block />
          </View>
        ) : (
          <View>
            {post.reposted ? (
              <MenuRow icon="undo" title={t('Desfazer repost')} text={t('Tira esta publicação do teu perfil.')} disabled={busy} onPress={() => void run(async () => onChange(await api.unrepost(post.id)))} />
            ) : allowed ? (
              <MenuRow icon="repeat" title={t('Repostar')} text={t('Partilha no teu perfil, tal como está.')} disabled={busy} onPress={() => void run(async () => { await api.repost(post.id); onChange({ reposted: true, reposts: post.reposts + 1 }); })} />
            ) : null}
            {allowed ? <MenuRow icon="pencil" title={t('Repostar com comentário')} text={t('Acrescenta o que achas ao partilhar.')} onPress={() => setQuote(true)} /> : null}
            {err ? <Text style={styles.err}>{err}</Text> : !allowed ? <Text style={styles.note}>{REPOST_BLOCKED()}</Text> : null}
          </View>
        )}
      </View>
    </Sheet>
  );
}

/**
 * ⋯ da publicação: partilhar, guardar, copiar ligação, editar, ocultar e apagar (as minhas), não me interessa e denunciar (de
 * outras pessoas). `myRepost`: a publicação está à vista dentro do meu repost simples (o menu é o do original, mas posso ocultar
 * o meu repost).
 */
export function PostMenuSheet({ post, mine, onClose, onSaved, onShare, anchor = null, myRepost = null }: { post: Post; mine: boolean; onClose: () => void; onSaved: (saved: boolean) => void; onShare?: () => void; /** Computador: abre como menu pendente junto a este sítio (o «⋯» ou o rato, no botão direito). */ anchor?: Rect | null; myRepost?: Pick<Post, 'id' | 'hidden'> | null }) {
  const qc = useQueryClient();
  const [view, setView] = useState<'menu' | 'edit' | 'report'>('menu');
  const [draft, setDraft] = useState(post.body);
  /** Só com texto (sem fotos, vídeo, geleira nem gelada): ao editar também se muda a letra. */
  const textOnly = post.kind === 'post' && post.media.length === 0 && !post.geleira && !post.gelada;
  const [draftFont, setDraftFont] = useState<TextFontId>(normTextFont(post.textFont));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState('');
  const refresh = async (keys: string[]) => { for (const k of keys) await qc.invalidateQueries({ queryKey: [k] }); };
  const deskMenu = useDesktop();

  async function copy() {
    try {
      await Clipboard.setStringAsync(postLink(post));
      setNote(t('Ligação copiada'));
    } catch {
      setNote(t('Não consegui copiar'));
    }
    setTimeout(() => setNote(''), 1800);
  }
  async function share() {
    if (onShare) {
      onShare();
      return;
    }
    try {
      const r = await Share.share(linkShare('', postLink(post)));
      if (r.action === Share.sharedAction) track('share', { target: 'system' });
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
  // Guardar o vídeo no telemóvel (ou descarregá-lo no site), com a assinatura e o cartão do fim (lib/saveTcheka).
  const [downloading, setDownloading] = useState(false);
  async function download() {
    if (downloading) return;
    setDownloading(true);
    const ok = await saveTcheka(post);
    setDownloading(false);
    if (ok) onClose();
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
  // «Ocultar publicação» / «Voltar a mostrar» (0169): sem pergunta; o aviso no fundo tem «Desfazer» (lib/hidePostAction).
  async function toggleHidden(target: Pick<Post, 'id' | 'hidden'>, repost: boolean) {
    onClose();
    await setPostHidden(qc, target, !target.hidden, repost);
  }
  async function confirmDelete() {
    if (!(await confirm({ title: t('Apagar a publicação?'), message: t('Deixa de aparecer para toda a gente, incluindo os reposts. Não dá para desfazer.'), confirm: t('Apagar'), danger: true }))) return;
    await api.removePost(post.id).catch(() => undefined);
    onClose();
    await refresh(['feed', 'profile-posts', 'post']);
  }
  // «Retirar o dueto»: só o autor da tcheka original, só em duetos (o vídeo e o som dele estão gravados no dueto).
  async function confirmTakedown() {
    if (!(await confirm({ title: takedownTitle(), message: takedownText(post.author.username), confirm: t('Retirar'), danger: true }))) return;
    try {
      await api.takeDownDuet(post.id);
      onClose();
      await refresh(['feed', 'profile-posts', 'post', 'reels', 'remixes']);
    } catch (e) {
      // Erro passageiro: o aviso no fundo (o menu continua aberto para tentar outra vez).
      showToast(e instanceof ApiError && e.message ? e.message : t('Não deu para retirar o dueto. Tenta outra vez daqui a pouco.'));
    }
  }
  async function saveEdit() {
    setSaving(true);
    setEditErr('');
    try {
      await api.updatePost(post.id, { body: draft, ...(textOnly ? { textFont: draftFont } : {}) });
      onClose();
      await refresh(['feed', 'profile-posts', 'post', 'reels']);
    } catch (e) {
      setEditErr((e as Error).message);
    }
    setSaving(false);
  }

  if (view === 'report') return <ReportSheet type="post" id={post.id} onReported={() => void refresh(["feed"])} onClose={onClose} />;
  if (view === 'edit') {
    return (
      <Sheet title={t('Editar a publicação')} onClose={onClose}>
        <View style={{ paddingHorizontal: 24 }}>
          <TextInput value={draft} onChangeText={setDraft} maxLength={2000} multiline autoFocus style={[styles.field, { minHeight: 120, textAlignVertical: 'top' }]} accessibilityLabel={t('Texto')} />
          {textOnly ? <FontChips value={draftFont} onChange={setDraftFont} label={t('Letra da publicação')} style={{ marginHorizontal: -24, marginTop: 10 }} /> : null}
          <Text style={styles.err}>{editErr}</Text>
          <Button label={t('Guardar')} onPress={() => void saveEdit()} loading={saving} block style={{ marginTop: 8 }} />
          <Button label={t('Cancelar')} kind="ghost" onPress={onClose} block style={{ marginTop: 8 }} />
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet title={t('Publicação')} onClose={onClose} variant="menu" anchor={anchor} cancel>
      <ScrollView style={{ paddingHorizontal: anchor && deskMenu ? 6 : 24 }}>
        <MenuRow icon="share" title={t('Partilhar')} text={t('No teu mimo, por ligação ou por outra app.')} onPress={() => void share()} />
        <MenuRow icon={<BookmarkIcon on={!!post.saved} size={22} color={colors.zinc800} />} title={post.saved ? t('Tirar dos guardados') : t('Guardar')} text={t('Só tu vês os teus guardados.')} onPress={() => void toggleSave()} />
        {canDownload(post) ? <MenuRow icon="download" title={Platform.OS === 'web' ? t('Descarregar o vídeo') : t('Guardar o vídeo')} text={downloading ? t('A preparar o vídeo…') : t('Com a assinatura do Txillapp no fim.')} onPress={() => void download()} disabled={downloading} /> : null}
        <MenuRow icon="link" title={t('Copiar ligação')} text={note || t('Para partilhares onde quiseres.')} onPress={() => void copy()} />
        {mine && !(post.kind === 'repost' && !post.body) && <MenuRow icon="pencil" title={t('Editar')} text={t('Muda o texto da publicação.')} onPress={() => { setDraft(post.body); setDraftFont(normTextFont(post.textFont)); setView('edit'); }} />}
        {mine && post.locationLabel && <MenuRow icon="map-pin" title={t('Tirar o local')} text={t('O sítio deixa de aparecer nesta publicação.')} onPress={() => void clearPlace()} />}
        {mine && <MenuRow icon="comment" title={post.commentsOff ? t('Ativar comentários') : t('Desativar comentários')} text={post.commentsOff ? t('Voltam a poder comentar.') : t('Ninguém pode comentar esta publicação.')} onPress={() => void toggleComments()} />}
        {mine && !(post.kind === 'repost' && !post.body) ? <MenuRow icon={post.hidden ? 'eye' : 'eye-off'} {...hideMenuRow(post)} onPress={() => void toggleHidden(post, false)} /> : null}
        {!mine && myRepost ? <MenuRow icon={myRepost.hidden ? 'eye' : 'eye-off'} {...hideMenuRow(myRepost, true)} onPress={() => void toggleHidden(myRepost, true)} /> : null}
        {mine ? (
          <MenuRow icon="trash" title={t('Apagar')} text={t('Some para toda a gente.')} danger onPress={() => void confirmDelete()} />
        ) : (
          <>
            <MenuRow icon="eye-off" title={t('Não me interessa')} text={t('Esta publicação deixa de aparecer no teu feed.')} onPress={() => void hide()} />
            {post.remixOf?.kind === 'duet' && post.remixOf.canTakeDown ? <MenuRow icon="trash" title={t('Retirar o dueto')} text={t('Foi feito com a tua tcheka. Deixa de aparecer para todos.')} danger onPress={() => void confirmTakedown()} /> : null}
            <MenuRow icon="flag" title={t('Denunciar')} text={t('Avisa a moderação. A pessoa não sabe.')} danger onPress={() => setView('report')} />
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
  field: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.zinc900 },
  amount: { flex: 1, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  amountText: { fontWeight: '600', fontSize: 16, color: colors.zinc900 },
  opts: { marginTop: 16, flexDirection: 'row', gap: 8 },
  opt: { flex: 1, borderWidth: 2, borderRadius: 16, padding: 10, alignItems: 'flex-start' },
  optTitle: { marginTop: 2, fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  optText: { marginTop: 2, fontSize: 11, lineHeight: 14, color: colors.zinc600 },
  err: { minHeight: 20, marginTop: 8, textAlign: 'center', fontSize: 14, color: colors.red600 },
  note: { minHeight: 20, marginTop: 8, textAlign: 'center', fontSize: 14, color: colors.zinc500 },
  primary: { marginTop: 8, height: 48, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghost: { marginTop: 8, height: 48, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontWeight: '600', fontSize: 16, color: colors.zinc800 },
  cancel: { marginTop: 8, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontWeight: '600', fontSize: 16, color: colors.zinc700 },
  sentText: { paddingVertical: 12, textAlign: 'center', fontSize: 18, color: colors.zinc900 },
});
