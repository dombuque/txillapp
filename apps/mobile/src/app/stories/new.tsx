import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { MentionSuggest, useMentionSuggest } from '@/components/MentionSuggest';
import { MusicPicker } from '@/components/MusicPicker';
import { ActivityIndicator } from '@/components/PontoLoader';
import { CloseFriendsSheet } from '@/components/StoryParts';
import { TxCamera, liveCameraSupported, type Shot } from '@/components/TxCamera';
import { api, uploadMedia } from '@/lib/api';
import { enqueueTask } from '@/lib/publishQueue';
import { shrinkPhoto } from '@/lib/cropToRatio';
import { musicApi, type Track } from '@/lib/api.music';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { FeatureIntro } from '@/components/FeatureIntro';
import { StickerCanvas, StickerPicker, StickerToolbar } from '@/components/Stickers';
import { MAX_STICKERS, newPlaced, type PlacedSticker } from '@/lib/stickers';
import { discardCopy, mimoEdited } from '@/lib/discardGuard';

const EMERALD = '#10b981';
const web = (o: Record<string, unknown>) => o as never;
type Asset = { uri: string; video: boolean; mime: string };

/**
 * Criar um status: no site abre a câmara oficial do Txillapp (foto ou vídeo até 60 s, galeria lá dentro);
 * na app abre a galeria/câmara do telemóvel. Depois, o editor: a foto inteira, legenda, música e para quem vai.
 */
export default function NewStory() {
  const router = useRouter();
  // Vindo da câmara do "+" com o Mimo escolhido: já traz a foto ou vídeo.
  const given = useLocalSearchParams<{ uri?: string; video?: string; mime?: string }>();
  const [asset, setAsset] = useState<Asset | null>(() => (given.uri ? { uri: String(given.uri), video: given.video === '1', mime: String(given.mime || (given.video === '1' ? 'video/mp4' : 'image/jpeg')) } : null));
  const [err, setErr] = useState('');
  const isWeb = Platform.OS === 'web';
  const cam = isWeb && liveCameraSupported();

  async function pick(source: 'camera' | 'library') {
    setErr('');
    try {
      if (source === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) return setErr('Preciso de acesso à câmara.');
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'], quality: 0.85, videoMaxDuration: 30, allowsEditing: !isWeb, aspect: [9, 16] };
      const r = await (source === 'camera' ? ImagePicker.launchCameraAsync(opts) : ImagePicker.launchImageLibraryAsync(opts));
      const a = r.canceled ? null : r.assets[0];
      if (a) setAsset({ uri: a.uri, video: a.type === 'video', mime: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg') });
      else if (!asset) router.back();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui abrir a câmara');
    }
  }
  useEffect(() => {
    // Sem câmara ao vivo e sem foto: abre logo a galeria. Vindo da câmara do "+" (com `uri`) já há foto — antes abria a
    // galeria por cima da foto acabada de tirar e editar (no Android).
    if (!cam && !given.uri) void pick('library');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const fromFiles = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    const video = f.type.startsWith('video/');
    setAsset({ uri: URL.createObjectURL(f), video, mime: f.type || (video ? 'video/mp4' : 'image/jpeg') });
  };

  if (!asset) {
    if (cam) {
      return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <TxCamera count={0} max={1} modes={['photo', 'video']} onShot={(s: Shot) => setAsset({ uri: s.uri, video: s.video, mime: s.mime })} onGallery={fromFiles} onClose={close} />
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {err ? <Text style={{ color: '#f87171', textAlign: 'center' }}>{err}</Text> : <ActivityIndicator color="#fff" />}
      </View>
    );
  }
  return <StoryEditor asset={asset} onRetake={() => (cam ? setAsset(null) : void pick('library'))} onCamera={cam ? undefined : () => void pick('camera')} onClose={close} />;
}

/** O editor: a foto/vídeo em ecrã inteiro, as ferramentas à direita, a legenda por cima e, em baixo, para quem vai e o enviar. */
function StoryEditor({ asset, onRetake, onCamera, onClose }: { asset: Asset; onRetake: () => void; onCamera?: () => void; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<'all' | 'close_friends'>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [fill, setFill] = useState(false); // a foto inteira (com fundo desfocado) ou a preencher o ecrã
  const [music, setMusic] = useState<Track | null>(null);
  const [pickMusic, setPickMusic] = useState(false);
  const [typing, setTyping] = useState(false);
  // @ na legenda: as pessoas mais próximas, logo por cima do campo.
  const captionRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const mention = useMentionSuggest({ text: caption, setText: (v) => setCaption(v.slice(0, 200)), inputRef: captionRef });
  // Stickers por cima: a lista, qual está escolhido, o selector aberto e o tamanho do ecrã (medido sem o teclado).
  const [stickers, setStickers] = useState<PlacedSticker[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [pickSticker, setPickSticker] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const friends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });
  const close = audience === 'close_friends';

  function addSticker(id: string) {
    setPickSticker(false);
    if (stickers.length >= MAX_STICKERS) return setErr(`Até ${MAX_STICKERS} stickers por mimo`);
    setStickers((l) => [...l, newPlaced(id)]);
    setSel(stickers.length);
  }
  const updateSel = (p: PlacedSticker) => setStickers((l) => l.map((x, i) => (i === sel ? p : x)));
  const deleteSel = () => { setStickers((l) => l.filter((_, i) => i !== sel)); setSel(null); };

  // Publicar em segundo plano (como a publicação): o ecrã fecha logo e o envio segue na faixa do Início.
  function publish() {
    if (busy) return;
    setBusy(true);
    const a = asset, text = caption.trim(), who = audience, track = music, placed = stickers;
    try {
      enqueueTask('mimo', { uri: a.uri, mime: a.mime, video: a.video }, async (_p, stage) => {
        // Fotos do recorte do sistema vêm à resolução original: reduz-se antes de enviar (os stickers usam posições relativas).
        const src = a.video ? a.uri : await shrinkPhoto(a.uri);
        const mime = src === a.uri ? a.mime : 'image/jpeg';
        const id = await uploadMedia(src, mime, 'public', () => stage('prepare'));
        stage('post');
        await musicApi.createStory(id, text, who, track, placed);
        await qc.invalidateQueries({ queryKey: ['stories'] });
      }, qc);
    } catch (e) {
      setBusy(false);
      return setErr((e as Error).message || 'Não consegui enviar o mimo. Tenta outra vez.');
    }
    if (router.canGoBack()) router.back();
    else router.replace('/' as never);
  }

  // Fechar (o × e o voltar do Android) perde a foto acabada de tirar e o que se lhe juntou: pergunta antes.
  // "Tirar outra" só pergunta se já houver legenda, stickers ou música (a foto nova substitui a antiga).
  function confirmClose() {
    if (busy) return;
    const t = discardCopy('mimo', asset.video);
    Alert.alert(t.title, t.message, [{ text: t.keep, style: 'cancel' }, { text: t.discard, style: 'destructive', onPress: onClose }]);
  }
  function confirmRetake(go: () => void) {
    if (!mimoEdited({ caption, stickers: stickers.length, music: !!music })) return go();
    const t = discardCopy('retake');
    Alert.alert(t.title, t.message, [{ text: t.keep, style: 'cancel' }, { text: t.discard, style: 'destructive', onPress: go }]);
  }
  const closeRef = useRef(confirmClose);
  closeRef.current = confirmClose;
  const overlayOpen = pickMusic || pickSticker || listOpen;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (overlayOpen) return false; // a folha por cima trata
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, [overlayOpen]);

  const tool = (icon: Parameters<typeof Icon>[0]['name'], label: string, onPress: () => void, on = false) => (
    <Pressable onPress={onPress} style={[st.tool, on && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}>
      <Icon name={icon} size={22} color={on ? colors.zinc900 : '#fff'} strokeWidth={2} />
    </Pressable>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior="padding" onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (!typing && (width !== box.w || height !== box.h)) setBox({ w: width, h: height }); }}>
      <FeatureIntro id="mimo" />
      {/* A cena: vídeo, ou a foto inteira sobre ela própria desfocada (sem barras pretas), ou a preencher. */}
      <View style={StyleSheet.absoluteFill}>
        {asset.video ? (
          <VideoPreview uri={asset.uri} />
        ) : (
          <>
            {!fill && <Image source={{ uri: asset.uri }} style={[StyleSheet.absoluteFill, { opacity: 0.6, transform: [{ scale: 1.3 }] }]} contentFit="cover" blurRadius={40} />}
            <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit={fill ? 'cover' : 'contain'} accessibilityLabel="Pré-visualização do mimo" />
          </>
        )}
      </View>
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, top: 0, height: 150, backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)' })} />
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, bottom: 0, height: 240, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' })} />

      {/* Os stickers pousados sobre a cena: arrastar, pinçar, rodar; largar no caixote apaga. */}
      <StickerCanvas stickers={stickers} onChange={setStickers} width={box.w} height={box.h} selected={sel} onSelect={setSel} />

      {/* Em cima: voltar à câmara; no meio, os botões do sticker escolhido; à direita, as ferramentas. */}
      <View style={[st.top, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable onPress={confirmClose} style={st.tool} accessibilityRole="button" accessibilityLabel="Cancelar"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        {sel !== null && stickers[sel] ? <StickerToolbar item={stickers[sel]} onChange={updateSel} onDelete={deleteSel} onDone={() => setSel(null)} /> : <View />}
        <View style={{ gap: 10 }}>
          {tool('camera', 'Tirar outra', () => confirmRetake(onCamera ?? onRetake))}
          {onCamera ? tool('images', 'Galeria', () => confirmRetake(onRetake)) : null}
          {!asset.video ? tool('expand', fill ? 'Mostrar a foto inteira' : 'Preencher o ecrã', () => setFill((f) => !f), fill) : null}
          {tool('music', music ? 'Mudar a música' : 'Adicionar música', () => setPickMusic(true), !!music)}
          {tool('sticker', 'Stickers', () => setPickSticker(true), stickers.length > 0)}
        </View>
      </View>

      {/* A legenda e a música pousam sobre a foto; em baixo, para quem vai e o enviar. */}
      <View style={[st.bottom, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        {music ? (
          <View style={st.musicChip}>
            <Icon name="music" size={16} color="#fff" />
            <Text style={{ flexShrink: 1, color: '#fff', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{music.title}{music.kind === 'clip' ? '' : ` · ${music.artist || 'Autor desconhecido'}`}</Text>
            <Pressable onPress={() => setMusic(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Tirar a música"><Icon name="x" size={16} color="#fff" strokeWidth={2.5} /></Pressable>
          </View>
        ) : null}
        <MentionSuggest mention={mention} style={{ marginHorizontal: 0, marginBottom: 8 }} />
        <TextInput
          ref={captionRef}
          value={caption}
          onChangeText={(v) => setCaption(v.slice(0, 200))}
          {...mention.inputProps}
          onFocus={() => { setTyping(true); mention.inputProps.onFocus(); }}
          onBlur={() => { setTyping(false); mention.inputProps.onBlur(); }}
          placeholder="Escreve uma legenda…"
          placeholderTextColor="rgba(255,255,255,0.75)"
          style={[st.caption, typing && { backgroundColor: 'rgba(0,0,0,0.6)' }]}
          accessibilityLabel="Legenda do mimo"
        />
        {err ? <Text accessibilityRole="alert" style={st.err}>{err}</Text> : null}
        <View style={st.sendRow}>
          <View style={{ flex: 1, flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Para quem vai">
            <Pressable onPress={() => setAudience('all')} style={[st.aud, { flex: 1.25 }, !close && st.audOn]} accessibilityRole="radio" accessibilityState={{ checked: !close }}>
              <Avatar name={user?.displayName ?? ''} username={user?.username} size={26} />
              <Text style={[st.audText, !close && { color: colors.zinc900 }]} numberOfLines={1}>Teu mimo</Text>
              {!close && <Icon name="check" size={16} color={colors.zinc900} strokeWidth={3} />}
            </Pressable>
            <Pressable onPress={() => setAudience('close_friends')} style={[st.aud, close && { backgroundColor: EMERALD }]} accessibilityRole="radio" accessibilityState={{ checked: close }}>
              <View style={st.heart}><Icon name="heart" size={15} solid color="#fff" /></View>
              <Text style={st.audText} numberOfLines={1}>Próximos</Text>
              {close && <Icon name="check" size={16} color="#fff" strokeWidth={3} />}
            </Pressable>
          </View>
          <Pressable onPress={() => void publish()} disabled={busy} style={({ pressed }) => [st.send, close && { backgroundColor: EMERALD }, busy && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.94 }] }]} accessibilityRole="button" accessibilityLabel={close ? 'Partilhar com amigos próximos' : 'Partilhar no mimo'}>
            {busy ? <ActivityIndicator color="#fff" /> : <Icon name="send" size={24} color="#fff" strokeWidth={2.2} />}
          </Pressable>
        </View>
        {close && (
          <Pressable onPress={() => setListOpen(true)} style={{ marginTop: 8 }} accessibilityRole="button">
            <Text style={{ textAlign: 'center', fontSize: 13, fontWeight: '600', color: '#6ee7b7' }}>{friends.data?.length ? `${friends.data.length} na lista · gerir` : 'A tua lista está vazia · adicionar amigos'}</Text>
          </Pressable>
        )}
      </View>
      {listOpen && <CloseFriendsSheet onClose={() => setListOpen(false)} />}
      {pickMusic && <MusicPicker hint={caption} onClose={() => setPickMusic(false)} onPick={(t) => { setMusic(t); setPickMusic(false); }} />}
      {pickSticker && <StickerPicker onClose={() => setPickSticker(false)} onPick={addSticker} />}
    </KeyboardAvoidingView>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}

const st = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tool: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 12 },
  musicChip: { alignSelf: 'center', maxWidth: '90%', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 14, paddingVertical: 8, marginBottom: 10 },
  caption: { minHeight: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 18, color: '#fff', fontSize: 16, outlineStyle: 'none' } as object,
  err: { marginTop: 8, color: '#fca5a5', textAlign: 'center', fontSize: 14 },
  sendRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  aud: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', paddingLeft: 8, paddingRight: 12 },
  audOn: { backgroundColor: '#fff' },
  audText: { flexShrink: 1, color: '#fff', fontSize: 14, fontWeight: '700' },
  heart: { width: 26, height: 26, borderRadius: 13, backgroundColor: EMERALD, alignItems: 'center', justifyContent: 'center' },
  send: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(214,51,79,0.45)' } as object,
});
