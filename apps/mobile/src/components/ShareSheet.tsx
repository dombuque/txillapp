import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { limitBuffer } from '@/lib/videoMemory';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, isTcheka, type Badged, type Post } from '@/lib/api';
import { useStableFrame } from '@/lib/useStableFrame';
import { extraApi } from '@/lib/api.extra';
import { track } from '@/lib/analytics';
import { SITE_URL, abs, sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { BackButton } from './BackButton';
import { Button } from './ui/Button';
import { SearchField } from './ui/SearchField';
import { NameWithBadge } from './NameWithBadge';
import { Icon, type IconName } from './Icon';
import { Sheet, useSheetScroll } from './Sheet';
import { useDesktop } from '@/lib/desktop';
import { StickerCanvas, StickerPicker, StickerToolbar } from './Stickers';
import { MAX_STICKERS, newPlaced, type MimoLayer } from '@/lib/stickers';
import { MAX_TEXT_LAYERS, countLayers, isTextLayer, newTextLayer, type TextLayer } from '@/lib/textLayers';
import { TextLayerEditor } from './TextLayers';
import { linkShare } from '@/lib/shareLink';
import { saveTcheka } from '@/lib/saveTcheka';
import { canDownload } from '@/lib/tchekaDownload';
import type { Track } from '@/lib/api.music';
import { MusicPicker } from './MusicPicker';
import { t } from '@/lib/i18n';

/** Uma conversa (pessoa ou grupo) na grelha de partilha. Pessoas: com o selo de verificado (`verified`, `verifiedTier`). */
interface Target extends Badged {
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

/** A fila de destinos: no telemóvel desliza; no computador parte em linhas, ao centro. */
function ActionsRow({ desktop, children }: { desktop: boolean; children: ReactNode }) {
  return desktop ? (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: 12, columnGap: 4 }}>{children}</View>
  ) : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }} keyboardShouldPersistTaps='handled'>{children}</ScrollView>
  );
}

function Body({ post, onClose }: { post: Post; onClose: () => void }) {
  const sheetScroll = useSheetScroll();
  // No computador os destinos partem em linhas (com o rato não se desliza a fila e o último ficava cortado).
  const desktop = useDesktop();
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Target[]>([]);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<'all' | 'close_friends' | null>(null);
  const [caption, setCaption] = useState('');
  const [stickers, setStickers] = useState<MimoLayer[]>([]);
  /** A música do mimo partilhado (a mesma escolha do mimo normal). */
  const [music, setMusic] = useState<Track | null>(null);
  const url = linkOf(post);
  // Os presentes vão para o status como um cartão desenhado no site (canvas); na app ainda não há essa imagem.
  const canStory = post.kind === 'post' && post.media.length > 0;

  const direct = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, staleTime: 30_000 });
  const groups = useQuery({ queryKey: ['chat-groups'], queryFn: api.chatGroups, staleTime: 30_000 });
  const txt = term.trim().replace(/^@/, '').toLowerCase();
  const found = useQuery({ queryKey: ['mentionable', txt], queryFn: () => api.mentionable(txt), enabled: txt.length >= 1, staleTime: 30_000 });

  const recents = useMemo<Target[]>(() => {
    const mins = (iso: string | null | undefined) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null);
    const people = (direct.data ?? []).filter((c) => !c.request).map((c): Target => {
      const m = mins(c.presence?.lastSeen);
      return {
        key: `u:${c.username}`, kind: 'user', id: c.username, name: c.displayName, verified: c.verified, verifiedTier: c.verifiedTier,
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
    if (!txt) return recents;
    const have = new Set(recents.map((r) => r.key));
    const hits = recents.filter((r) => r.name.toLowerCase().includes(txt) || r.id.toLowerCase().includes(txt));
    const more = (found.data ?? [])
      .filter((p) => !have.has(`u:${p.username}`))
      .map((p): Target => ({ key: `u:${p.username}`, kind: 'user', id: p.username, name: p.displayName, verified: p.verified, verifiedTier: p.verifiedTier, avatars: [{ name: p.displayName, username: p.hasAvatar ? p.username : undefined }], online: false, recent: null, at: '' }));
    return [...hits, ...more];
  }, [txt, recents, found.data]);

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
    setNote(picked.length === 1 ? t('Enviado a {name}', { name: picked[0].name }) : t('Enviado a {n} conversas', { n: picked.length }));
    setTimeout(onClose, 900);
  }

  // Escolher o status abre primeiro a pré-visualização: vês como fica, escreves uma legenda e só depois partilhas.
  function toStory(audience: 'all' | 'close_friends') {
    // A geleira partilhada ainda não tem imagem para o mimo: vai pelas conversas ou pelo link.
    if (!canStory) return setNote(post.geleira ? t('A geleira ainda não vai para o mimo: envia-a numa conversa ou partilha o link') : t('Só se partilham no mimo publicações com foto ou vídeo'));
    setPreview(audience);
  }
  async function publishStory() {
    if (!preview) return;
    setBusy(true);
    try {
      await extraApi.shareToStory(post.id, preview, caption.trim(), stickers, music);
      const aud = preview;
      setPreview(null);
      setNote(aud === 'all' ? t('Adicionado ao teu mimo') : t('Partilhado com amigos próximos'));
      setTimeout(onClose, 1000);
    } catch (e) {
      setNote((e as Error).message);
      setPreview(null);
    }
    setBusy(false);
  }
  /** O vídeo com a assinatura e o cartão do fim: na galeria (telemóvel) ou na folha de partilha / descarregado (site). */
  async function download() {
    setBusy(true);
    setNote(t('A preparar o vídeo…'));
    await saveTcheka(post);
    setBusy(false);
    setNote('');
  }
  async function copy() {
    try {
      await Clipboard.setStringAsync(url);
      track('share', { target: 'link' });
      setNote(t('Link copiado. Bora espalhar!'));
    } catch {
      setNote(t('Não consegui copiar'));
    }
  }
  const open = (href: string) => void Linking.openURL(href).then(() => track('share', { target: 'app' }), () => setNote(t('Não consegui abrir a app')));
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
        <SearchField value={term} onChangeText={setTerm} placeholder={t('Procurar')} accessibilityLabel={t('Procurar pessoas e TxillGroups')} />
      </View>

      <ScrollView style={{ flexGrow: 0, maxHeight: txt ? 420 : undefined }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={(e) => { if (sheetScroll) sheetScroll.top.current = e.nativeEvent.contentOffset.y <= 0; }}>
        {(direct.isLoading || groups.isLoading) && <ActivityIndicator style={{ marginVertical: 40 }} color={colors.brand} />}
        {!direct.isLoading && list.length === 0 && <Text style={st.none}>{txt ? t('Ninguém com esse nome') : t('Ainda não tens conversas. Procura alguém pelo nome.')}</Text>}
        <View style={st.grid}>
          {/* Sem pesquisa: só as duas primeiras filas (as conversas mais recentes); o resto encontra-se a procurar. */}
          {(txt ? list : list.slice(0, 6)).map((x) => {
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
                  {x.online && <View style={st.online} accessibilityLabel={t('Online')} />}
                  {x.recent !== null && <View style={st.recent}><Text style={{ fontSize: 11, fontWeight: '700', lineHeight: 16, color: '#047857' }}>{x.recent}m</Text></View>}
                  {on && <View style={st.picked}><Icon name="check" size={32} strokeWidth={3} color="#fff" /></View>}
                </View>
                <NameWithBadge name={x.name} who={x} center numberOfLines={2} style={st.name} containerStyle={{ width: '100%' }} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {note ? <Text accessibilityRole="alert" style={st.note}>{note}</Text> : null}

      {picked.length > 0 ? (
        <View style={st.bottom}>
          <TextInput value={message} onChangeText={setMessage} maxLength={500} placeholder={t('Escrever uma mensagem…')} placeholderTextColor={colors.zinc500} accessibilityLabel={t('Mensagem')} style={st.msg} />
          <Button label={picked.length === 1 ? t('Enviar a {split}', { split: picked[0].name.split(' ')[0] }) : t('Enviar a {n} conversas', { n: picked.length })} onPress={() => void sendAll()} loading={busy} block style={{ marginTop: 12, marginHorizontal: 4 }} />
        </View>
      ) : (
        <View style={st.bottom}>
          <ActionsRow desktop={desktop}>
            {action('square-plus', t('Adicionar ao mimo'), () => toStory('all'), canStory ? colors.brand : colors.zinc100, canStory ? '#fff' : '#a1a1aa')}
            {action('heart', t('Amigos próximos'), () => toStory('close_friends'), canStory ? EMERALD : colors.zinc100, canStory ? '#fff' : '#a1a1aa')}
            {action('messages', 'WhatsApp', () => open(`https://wa.me/?text=${enc(url)}`), EMERALD_DARK, '#fff')}
            {letter(t('Telegram'), 'T', '#0ea5e9', () => open(`https://t.me/share/url?url=${enc(url)}`))}
            {letter('Facebook', 'f', '#2563eb', () => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`))}
            {letter('X', 'X', colors.zinc900, () => open(`https://twitter.com/intent/tweet?url=${enc(url)}`))}
            {canDownload(post) ? action('download', Platform.OS === 'web' ? t('Descarregar') : t('Guardar vídeo'), () => void download()) : null}
            {action('link', t('Copiar link'), () => void copy())}
            {action('share', t('Partilhar…'), () => void system())}
          </ActionsRow>
        </View>
      )}

      {preview ? (
        <Modal visible transparent={false} animationType="slide" onRequestClose={() => setPreview(null)} statusBarTranslucent>
          <StoryPreview post={post} audience={preview} setAudience={setPreview} caption={caption} setCaption={setCaption} stickers={stickers} setStickers={setStickers} music={music} setMusic={setMusic} busy={busy} onBack={() => setPreview(null)} onPublish={() => void publishStory()} />
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
function StoryPreview({ post, audience, setAudience, caption, setCaption, stickers, setStickers, music, setMusic, busy, onBack, onPublish }: {
  post: Post; audience: 'all' | 'close_friends'; setAudience: (a: 'all' | 'close_friends') => void; caption: string; setCaption: (c: string) => void;
  stickers: MimoLayer[]; setStickers: (s: MimoLayer[]) => void; music: Track | null; setMusic: (t: Track | null) => void; busy: boolean; onBack: () => void; onPublish: () => void;
}) {
  const [pickMusic, setPickMusic] = useState(false);
  const insets = useSafeAreaInsets();
  const [sel, setSel] = useState<number | null>(null);
  const [pick, setPick] = useState(false);
  /** O texto a escrever por cima (`index` null: um novo). */
  const [textEdit, setTextEdit] = useState<{ index: number | null; layer: TextLayer } | null>(null);
  const counts = countLayers(stickers);
  // A escrever (a legenda ou um texto por cima): a moldura fica do tamanho que tinha sem o teclado (lib/useStableFrame) e
  // só a barra da legenda sobe para cima dele. Antes, no iPhone, a imagem encolhia com a janela ao abrir o teclado.
  const [capFocus, setCapFocus] = useState(false);
  const { screen, lift } = useStableFrame(capFocus || !!textEdit);
  const bottomPad = Math.max(insets.bottom, 16);
  const raise = capFocus ? Math.max(0, lift - bottomPad + 8) : 0;
  // Moldura 9:16 com tamanho real (só `aspectRatio` colapsa a zero no Safari): cabe na largura e deixa espaço aos controlos.
  const ph = Math.max(240, Math.min(screen.h - insets.top - insets.bottom - 260, 640));
  const pw = Math.min(360, screen.w - 32, Math.round(ph * 9 / 16));
  const m = post.media[0];
  const still = m?.kind === 'video' ? abs(m.posterUrl) : sized(m?.url, 1080);
  function addSticker(id: string) {
    setPick(false);
    if (counts.stickers >= MAX_STICKERS) return;
    setStickers([...stickers, newPlaced(id)]);
    setSel(stickers.length);
  }
  const editText = (i: number) => { const l = stickers[i]; if (l && isTextLayer(l)) setTextEdit({ index: i, layer: l }); };
  /** «Feito»: pousa o texto novo, troca o reescrito, ou apaga-o se ficou vazio. */
  function textDone(layer: TextLayer) {
    const ed = textEdit;
    setTextEdit(null);
    if (!ed) return;
    if (ed.index === null) {
      if (layer.text) { setStickers([...stickers, layer]); setSel(stickers.length); }
      return;
    }
    const at = ed.index;
    setStickers(layer.text ? stickers.map((x, i) => (i === at ? layer : x)) : stickers.filter((_, i) => i !== at));
    setSel(layer.text ? at : null);
  }
  return (
    <View style={{ height: screen.h, backgroundColor: '#000', paddingTop: Math.max(insets.top, 8), paddingBottom: bottomPad }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingBottom: 8 }}>
        <BackButton onPress={onBack} color="#fff" />
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: '#fff' }}>{t('Pré-visualização do mimo')}</Text>
        {sel !== null && stickers[sel]
          ? <StickerToolbar item={stickers[sel]} onChange={(p) => setStickers(stickers.map((x, i) => (i === sel ? p : x)))} onDelete={() => { setStickers(stickers.filter((_, i) => i !== sel)); setSel(null); }} onDone={() => setSel(null)} />
          : <>
            <Pressable onPress={() => setPickMusic(true)} accessibilityRole="button" accessibilityLabel={music ? t('Mudar a música') : t('Adicionar música')} style={[st.back, music && { backgroundColor: '#fff' }]}><Icon name="music" size={24} color={music ? colors.zinc900 : '#fff'} strokeWidth={2} /></Pressable>
            <Pressable onPress={() => setPick(true)} accessibilityRole="button" accessibilityLabel={t('Stickers')} style={[st.back, counts.stickers > 0 && { backgroundColor: '#fff' }]}><Icon name="sticker" size={24} color={counts.stickers > 0 ? colors.zinc900 : '#fff'} strokeWidth={2} /></Pressable>
            <Pressable onPress={() => { setSel(null); if (counts.texts < MAX_TEXT_LAYERS) setTextEdit({ index: null, layer: newTextLayer() }); }} disabled={counts.texts >= MAX_TEXT_LAYERS} accessibilityRole="button" accessibilityLabel={t('Texto')} accessibilityHint={t('Escrever por cima do mimo')} style={[st.back, counts.texts > 0 && { backgroundColor: '#fff' }]}><Text style={{ fontSize: 17, fontWeight: '800', color: counts.texts > 0 ? colors.zinc900 : '#fff' }}>{t('Aa')}</Text></Pressable>
          </>}
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
          <StickerCanvas stickers={stickers} onChange={setStickers} width={pw} height={Math.round(pw * 16 / 9)} selected={sel} onSelect={setSel} onEdit={editText} hidden={textEdit?.index ?? null} />
        </View>
      </View>
      {pick && <StickerPicker onClose={() => setPick(false)} onPick={addSticker} />}
      {textEdit && <TextLayerEditor initial={textEdit.layer} boxW={pw} onDone={textDone} />}
      {pickMusic && <MusicPicker hint={caption || post.body} allowLocal onClose={() => setPickMusic(false)} onPick={(t) => { setMusic(t); setPickMusic(false); }} />}
      <View style={[{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }, raise ? { transform: [{ translateY: -raise }], backgroundColor: 'rgba(0,0,0,0.85)', paddingBottom: 8 } : null]}>
        {music ? (
          <View style={st.musicChip}>
            <Icon name="music" size={16} color="#fff" />
            <Text style={{ flex: 1, minWidth: 0, color: '#fff', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{music.title}{music.kind === 'clip' ? '' : ` · ${music.artist || t('Autor desconhecido')}`}</Text>
            <Pressable onPress={() => setMusic(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Tirar a música')}><Icon name="x" size={18} color="#fff" strokeWidth={2.5} /></Pressable>
          </View>
        ) : null}
        <TextInput value={caption} onChangeText={(v) => setCaption(v.slice(0, 200))} placeholder={t('Adicionar legenda…')} placeholderTextColor="rgba(255,255,255,0.6)" accessibilityLabel={t('Legenda')} onFocus={() => setCapFocus(true)} onBlur={() => setCapFocus(false)} style={st.cap} />
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
          {([['all', t('Os teus seguidores'), 'square-plus'], ['close_friends', t('Amigos próximos'), 'heart']] as const).map(([v, label, ic]) => {
            const on = audience === v;
            return (
              <Pressable key={v} onPress={() => setAudience(v)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[st.aud, { backgroundColor: on ? (v === 'all' ? '#fff' : EMERALD) : 'rgba(255,255,255,0.15)' }]}>
                <Icon name={ic} size={18} color={on && v === 'all' ? colors.zinc900 : '#fff'} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: on && v === 'all' ? colors.zinc900 : '#fff' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Button label={t('Partilhar no mimo')} onPress={onPublish} loading={busy} dark block />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  musicChip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 14, paddingVertical: 10 },
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
  name: { textAlign: 'center', fontSize: 13, fontWeight: '500', lineHeight: 16, color: colors.zinc800 },
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
