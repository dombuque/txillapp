import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { limitBuffer } from '@/lib/videoMemory';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Modal } from '@/components/Modal';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, isTcheka, type Post } from '@/lib/api';
import { extraApi } from '@/lib/api.extra';
import { track } from '@/lib/analytics';
import { SITE_URL, abs, sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { NameWithBadge } from './NameWithBadge';
import { Icon, type IconName } from './Icon';
import { Sheet, useSheetScroll } from './Sheet';
import { StickerCanvas, StickerPicker, StickerToolbar } from './Stickers';
import { MAX_STICKERS, newPlaced, type PlacedSticker } from '@/lib/stickers';
import { linkShare } from '@/lib/shareLink';

/** Uma conversa (pessoa ou grupo) na grelha de partilha. */
interface Target {
  key: string;
  kind: 'user' | 'group';
  id: string; // @utilizador ou id do grupo
  name: string;
  avatars: { name: string; username?: string }[];
  online: boolean;
  /** Minutos desde que esteve online (só se foi há menos de uma hora). */
  recent: number | null;
  at: string;
}

const EMERALD = '#10b981';
const EMERALD_DARK = '#059669';

/** O link limpo de uma publicação ou tcheka: txillapp.com/p/Ab3xK9q (tchekas: /r/…). Sempre no site público. */
const linkOf = (post: Post) => `${SITE_URL || 'https://txillapp.com'}/${isTcheka(post) ? 'r' : 'p'}/${post.code}`;

/**
 * Partilhar uma publicação ou tcheka (igual ao ShareSheet do site): pesquisa no topo, grelha das conversas recentes
 * (toca para escolher várias) e, em baixo, as ações: status, amigos próximos, WhatsApp, Telegram, Facebook, X, copiar link e
 * o menu do telemóvel. Escolhidas pessoas, a barra de baixo passa a ser uma mensagem opcional e o botão Enviar.
 */
export function ShareSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} plain>
      <Body post={post} onClose={onClose} />
    </Sheet>
  );
}

function Body({ post, onClose }: { post: Post; onClose: () => void }) {
  const sheetScroll = useSheetScroll();
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Target[]>([]);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<'all' | 'close_friends' | null>(null);
  const [caption, setCaption] = useState('');
  const [stickers, setStickers] = useState<PlacedSticker[]>([]);
  const url = linkOf(post);
  // Os presentes vão para o status como um cartão desenhado no site (canvas); na app ainda não há essa imagem.
  const canStory = post.kind === 'post' && post.media.length > 0;

  const direct = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, staleTime: 30_000 });
  const groups = useQuery({ queryKey: ['chat-groups'], queryFn: api.chatGroups, staleTime: 30_000 });
  const t = term.trim().replace(/^@/, '').toLowerCase();
  const found = useQuery({ queryKey: ['mentionable', t], queryFn: () => api.mentionable(t), enabled: t.length >= 1, staleTime: 30_000 });

  const recents = useMemo<Target[]>(() => {
    const mins = (iso: string | null | undefined) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null);
    const people = (direct.data ?? []).filter((c) => !c.request).map((c): Target => {
      const m = mins(c.presence?.lastSeen);
      return {
        key: `u:${c.username}`, kind: 'user', id: c.username, name: c.displayName,
        avatars: [{ name: c.displayName, username: c.hasAvatar ? c.username : undefined }],
        online: !!c.presence?.online, recent: !c.presence?.online && m !== null && m < 60 ? Math.max(1, m) : null, at: c.lastMessage.at,
      };
    });
    const gs = (groups.data ?? []).map((g): Target => ({
      key: `g:${g.id}`, kind: 'group', id: g.id, name: g.name,
      avatars: g.preview.slice(0, 2).map((p) => ({ name: p.displayName, username: p.hasAvatar ? p.username : undefined })),
      online: false, recent: null, at: g.lastMessage.at,
    }));
    return [...people, ...gs].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }, [direct.data, groups.data]);

  const list = useMemo<Target[]>(() => {
    if (!t) return recents;
    const have = new Set(recents.map((r) => r.key));
    const hits = recents.filter((r) => r.name.toLowerCase().includes(t) || r.id.toLowerCase().includes(t));
    const more = (found.data ?? [])
      .filter((p) => !have.has(`u:${p.username}`))
      .map((p): Target => ({ key: `u:${p.username}`, kind: 'user', id: p.username, name: p.displayName, avatars: [{ name: p.displayName, username: p.hasAvatar ? p.username : undefined }], online: false, recent: null, at: '' }));
    return [...hits, ...more];
  }, [t, recents, found.data]);

  const isPicked = (k: string) => picked.some((p) => p.key === k);
  const toggle = (x: Target) => setPicked((l) => (isPicked(x.key) ? l.filter((p) => p.key !== x.key) : [...l, x]));

  // A nota some sozinha (menos quando vamos fechar a folha).
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(''), 2500);
    return () => clearTimeout(id);
  }, [note]);

  async function sendAll() {
    setBusy(true);
    setNote('');
    const failed: string[] = [];
    for (const x of picked) {
      try {
        const send = (b: { kind: 'post' | 'text'; body: string }) => (x.kind === 'user' ? api.chatSend(x.id, b) : extraApi.chatGroupSend(x.id, b));
        await send({ kind: 'post', body: post.id });
        if (message.trim()) await send({ kind: 'text', body: message.trim() });
      } catch (e) {
        failed.push(`${x.name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    if (failed.length) return setNote(failed.join(' · '));
    setNote(picked.length === 1 ? `Enviado a ${picked[0].name}` : `Enviado a ${picked.length} conversas`);
    setTimeout(onClose, 900);
  }

  // Escolher o status abre primeiro a pré-visualização: vês como fica, escreves uma legenda e só depois partilhas.
  function toStory(audience: 'all' | 'close_friends') {
    if (!canStory) return setNote('Só se partilham no mimo publicações com foto ou vídeo');
    setPreview(audience);
  }
  async function publishStory() {
    if (!preview) return;
    setBusy(true);
    try {
      await extraApi.shareToStory(post.id, preview, caption.trim(), stickers);
      const aud = preview;
      setPreview(null);
      setNote(aud === 'all' ? 'Adicionado ao teu mimo' : 'Partilhado com amigos próximos');
      setTimeout(onClose, 1000);
    } catch (e) {
      setNote((e as Error).message);
      setPreview(null);
    }
    setBusy(false);
  }
  async function copy() {
    try {
      await Clipboard.setStringAsync(url);
      track('share', { target: 'link' });
      setNote('Link copiado. Bora espalhar!');
    } catch {
      setNote('Não consegui copiar');
    }
  }
  const open = (href: string) => void Linking.openURL(href).then(() => track('share', { target: 'app' }), () => setNote('Não consegui abrir a app'));
  async function system() {
    try {
      const r = await Share.share(linkShare('', url));
      if (r.action === Share.sharedAction) {
        track('share', { target: 'system' });
        onClose();
      }
    } catch {
      /* cancelado */
    }
  }

  const action = (icon: IconName, label: string, run: () => void, bg = colors.zinc100, fg = colors.zinc900) => (
    <Pressable key={label} onPress={run} disabled={busy} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [st.act, pressed && { transform: [{ scale: 0.95 }] }, busy && { opacity: 0.5 }]}>
      <View style={[st.actCircle, { backgroundColor: bg }]}><Icon name={icon} size={26} color={fg} /></View>
      <Text style={st.actLabel}>{label}</Text>
    </Pressable>
  );
  const letter = (label: string, mark: string, bg: string, run: () => void) => (
    <Pressable key={label} onPress={run} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [st.act, pressed && { transform: [{ scale: 0.95 }] }]}>
      <View style={[st.actCircle, { backgroundColor: bg }]}><Text style={{ fontSize: 24, fontWeight: '800', color: '#fff' }}>{mark}</Text></View>
      <Text style={st.actLabel}>{label}</Text>
    </Pressable>
  );
  const enc = encodeURIComponent;

  return (
    <View>
      <View style={st.searchRow}>
        <View style={st.search}>
          <Icon name="search" size={18} color={colors.zinc500} />
          <TextInput value={term} onChangeText={setTerm} placeholder="Procurar" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar pessoas e TxillGroups" autoCapitalize="none" autoCorrect={false} style={st.input} />
        </View>
      </View>

      <ScrollView style={{ flexGrow: 0, maxHeight: t ? 420 : undefined }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={(e) => { if (sheetScroll) sheetScroll.top.current = e.nativeEvent.contentOffset.y <= 0; }}>
        {(direct.isLoading || groups.isLoading) && <ActivityIndicator style={{ marginVertical: 40 }} color={colors.brand} />}
        {!direct.isLoading && list.length === 0 && <Text style={st.none}>{t ? 'Ninguém com esse nome' : 'Ainda não tens conversas. Procura alguém pelo nome.'}</Text>}
        <View style={st.grid}>
          {/* Sem pesquisa: só as duas primeiras filas (as conversas mais recentes); o resto encontra-se a procurar. */}
          {(t ? list : list.slice(0, 6)).map((x) => {
            const on = isPicked(x.key);
            return (
              <Pressable key={x.key} onPress={() => toggle(x)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={x.name} style={({ pressed }) => [st.cell, pressed && { transform: [{ scale: 0.95 }] }]}>
                <View style={{ width: 72, height: 72 }}>
                  {x.kind === 'group' ? (
                    <View style={{ width: 72, height: 72 }}>
                      {x.avatars.slice(0, 2).map((a, i) => (
                        <View key={i} style={[st.gAvatar, i === 0 ? { left: 0, top: 0 } : { right: 0, bottom: 0 }]}><Avatar name={a.name} username={a.username} size={46} /></View>
                      ))}
                      {x.avatars.length === 0 && <View style={st.gEmpty}><Icon name="users" size={30} color={colors.zinc600} /></View>}
                    </View>
                  ) : (
                    <Avatar name={x.avatars[0].name} username={x.avatars[0].username} size={72} />
                  )}
                  {x.online && <View style={st.online} accessibilityLabel="Online" />}
                  {x.recent !== null && <View style={st.recent}><Text style={{ fontSize: 11, fontWeight: '700', lineHeight: 16, color: '#047857' }}>{x.recent}m</Text></View>}
                  {on && <View style={st.picked}><Icon name="check" size={32} strokeWidth={3} color="#fff" /></View>}
                </View>
                <Text style={st.name} numberOfLines={2}>{x.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {note ? <Text accessibilityRole="alert" style={st.note}>{note}</Text> : null}

      {picked.length > 0 ? (
        <View style={st.bottom}>
          <TextInput value={message} onChangeText={setMessage} maxLength={500} placeholder="Escrever uma mensagem…" placeholderTextColor={colors.zinc500} accessibilityLabel="Mensagem" style={st.msg} />
          <Pressable onPress={() => void sendAll()} disabled={busy} accessibilityRole="button" style={({ pressed }) => [st.send, busy && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.98 }] }]}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }}>{busy ? 'A enviar…' : picked.length === 1 ? `Enviar a ${picked[0].name.split(' ')[0]}` : `Enviar a ${picked.length} conversas`}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={st.bottom}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }} keyboardShouldPersistTaps="handled">
            {action('square-plus', 'Adicionar ao mimo', () => toStory('all'), canStory ? colors.brand : colors.zinc100, canStory ? '#fff' : '#a1a1aa')}
            {action('heart', 'Amigos próximos', () => toStory('close_friends'), canStory ? EMERALD : colors.zinc100, canStory ? '#fff' : '#a1a1aa')}
            {action('messages', 'WhatsApp', () => open(`https://wa.me/?text=${enc(url)}`), EMERALD_DARK, '#fff')}
            {letter('Telegram', 'T', '#0ea5e9', () => open(`https://t.me/share/url?url=${enc(url)}`))}
            {letter('Facebook', 'f', '#2563eb', () => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`))}
            {letter('X', 'X', colors.zinc900, () => open(`https://twitter.com/intent/tweet?url=${enc(url)}`))}
            {action('link', 'Copiar link', () => void copy())}
            {action('share', 'Partilhar…', () => void system())}
          </ScrollView>
        </View>
      )}

      {preview ? (
        <Modal visible transparent={false} animationType="slide" onRequestClose={() => setPreview(null)} statusBarTranslucent>
          <StoryPreview post={post} audience={preview} setAudience={setPreview} caption={caption} setCaption={setCaption} stickers={stickers} setStickers={setStickers} busy={busy} onBack={() => setPreview(null)} onPublish={() => void publishStory()} />
        </Modal>
      ) : null}
    </View>
  );
}

/** O vídeo da publicação a tocar na pré-visualização (em ciclo, com som), como vai ficar no status. */
function PreviewVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => { limitBuffer(p, 'full'); p.loop = true; p.muted = false; p.play(); });
  // O Safari pode recusar tocar com som sem um toque recente: nesse caso toca sem som.
  useEffect(() => {
    const t = setTimeout(() => { try { if (!player.playing) { player.muted = true; player.play(); } } catch { /* leitor libertado */ } }, 700);
    return () => { clearTimeout(t); try { player.pause(); } catch { /* já libertado */ } };
  }, [player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} surfaceType="textureView" />;
}

/** Pré-visualização do mimo: o ecrã 9:16 com a publicação, os stickers por cima, a legenda e a escolha de quem vê. */
function StoryPreview({ post, audience, setAudience, caption, setCaption, stickers, setStickers, busy, onBack, onPublish }: {
  post: Post; audience: 'all' | 'close_friends'; setAudience: (a: 'all' | 'close_friends') => void; caption: string; setCaption: (c: string) => void;
  stickers: PlacedSticker[]; setStickers: (s: PlacedSticker[]) => void; busy: boolean; onBack: () => void; onPublish: () => void;
}) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [sel, setSel] = useState<number | null>(null);
  const [pick, setPick] = useState(false);
  // Moldura 9:16 com tamanho real (só `aspectRatio` colapsa a zero no Safari): cabe na largura e deixa espaço aos controlos.
  const ph = Math.max(240, Math.min(win.height - insets.top - insets.bottom - 260, 640));
  const pw = Math.min(360, win.width - 32, Math.round(ph * 9 / 16));
  const m = post.media[0];
  const still = m?.kind === 'video' ? abs(m.posterUrl) : sized(m?.url, 1080);
  function addSticker(id: string) {
    setPick(false);
    if (stickers.length >= MAX_STICKERS) return;
    setStickers([...stickers, newPlaced(id)]);
    setSel(stickers.length);
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 16) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingBottom: 8 }}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Voltar" style={st.back}><Icon name="back" size={24} color="#fff" /></Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: '#fff' }}>Pré-visualização do mimo</Text>
        {sel !== null && stickers[sel]
          ? <StickerToolbar item={stickers[sel]} onChange={(p) => setStickers(stickers.map((x, i) => (i === sel ? p : x)))} onDelete={() => { setStickers(stickers.filter((_, i) => i !== sel)); setSel(null); }} onDone={() => setSel(null)} />
          : <Pressable onPress={() => setPick(true)} accessibilityRole="button" accessibilityLabel="Stickers" style={[st.back, stickers.length > 0 && { backgroundColor: '#fff' }]}><Icon name="sticker" size={22} color={stickers.length > 0 ? colors.zinc900 : '#fff'} strokeWidth={2} /></Pressable>}
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
        <View style={[st.phone, { width: pw, height: Math.round(pw * 16 / 9) }]}>
          {still ? <Image source={{ uri: still }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          {m?.kind === 'video' && abs(m.url) ? <PreviewVideo url={abs(m.url)!} /> : null}
          <View style={st.phoneTop}>
            <Avatar name={post.author.displayName} username={post.author.username} size={30} />
            <NameWithBadge name={`@${post.author.username}`} who={post.author} style={{ fontSize: 13, fontWeight: '600', color: '#fff' }} containerStyle={{ flexShrink: 1 }} />
          </View>
          {caption.trim() ? <Text style={st.phoneCaption}>{caption}</Text> : null}
          <StickerCanvas stickers={stickers} onChange={setStickers} width={pw} height={Math.round(pw * 16 / 9)} selected={sel} onSelect={setSel} />
        </View>
      </View>
      {pick && <StickerPicker onClose={() => setPick(false)} onPick={addSticker} />}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
        <TextInput value={caption} onChangeText={(v) => setCaption(v.slice(0, 200))} placeholder="Adicionar legenda…" placeholderTextColor="rgba(255,255,255,0.6)" accessibilityLabel="Legenda" style={st.cap} />
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
          {([['all', 'Os teus seguidores', 'square-plus'], ['close_friends', 'Amigos próximos', 'heart']] as const).map(([v, label, ic]) => {
            const on = audience === v;
            return (
              <Pressable key={v} onPress={() => setAudience(v)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[st.aud, { backgroundColor: on ? (v === 'all' ? '#fff' : EMERALD) : 'rgba(255,255,255,0.15)' }]}>
                <Icon name={ic} size={18} color={on && v === 'all' ? colors.zinc900 : '#fff'} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: on && v === 'all' ? colors.zinc900 : '#fff' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={onPublish} disabled={busy} accessibilityRole="button" style={({ pressed }) => [st.send, { marginTop: 0 }, busy && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.98 }] }]}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }}>{busy ? 'A partilhar…' : 'Partilhar no mimo'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  searchRow: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 4 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  none: { paddingVertical: 40, textAlign: 'center', fontSize: 16, color: colors.zinc500 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, paddingTop: 8 },
  cell: { width: '33.3333%', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  gAvatar: { position: 'absolute', borderRadius: 30, borderWidth: 2, borderColor: '#fff', backgroundColor: '#fff' },
  gEmpty: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  online: { position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#fff', backgroundColor: EMERALD },
  recent: { position: 'absolute', right: 0, bottom: -4, borderRadius: 999, borderWidth: 2, borderColor: '#fff', backgroundColor: '#d1fae5', paddingHorizontal: 6 },
  picked: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 36, backgroundColor: 'rgba(214,51,79,0.7)', alignItems: 'center', justifyContent: 'center' },
  name: { width: '100%', textAlign: 'center', fontSize: 13, fontWeight: '500', lineHeight: 16, color: colors.zinc800 },
  note: { marginHorizontal: 16, marginBottom: 4, borderRadius: 12, backgroundColor: '#fafafa', paddingHorizontal: 12, paddingVertical: 8, textAlign: 'center', fontSize: 14, fontWeight: '600', color: colors.zinc800 },
  bottom: { borderTopWidth: 1, borderTopColor: colors.zinc100, paddingHorizontal: 12, paddingTop: 16 },
  msg: { height: 48, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 20, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never, marginHorizontal: 4 },
  send: { marginTop: 12, marginHorizontal: 4, height: 48, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  act: { width: 74, alignItems: 'center', gap: 6 },
  actCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  actLabel: { width: '100%', textAlign: 'center', fontSize: 12, fontWeight: '500', lineHeight: 15, color: colors.zinc700 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  phone: { borderRadius: 22, overflow: 'hidden', backgroundColor: colors.zinc900 },
  phoneTop: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: 'rgba(0,0,0,0.3)' },
  phoneCaption: { position: 'absolute', left: 12, right: 12, bottom: 16, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 8, textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#fff' },
  playBadge: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  cap: { height: 48, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 20, fontSize: 16, color: '#fff', outlineStyle: 'none' as never },
  aud: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999 },
});
