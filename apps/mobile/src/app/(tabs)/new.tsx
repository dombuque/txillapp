import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createElement, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { LiveCamera, liveCameraSupported, type Shot } from '@/components/LiveCamera';
import { MusicPicker } from '@/components/MusicPicker';
import { PhotoTagger } from '@/components/PhotoTagger';
import { PlaceSheet, type PlaceGeo } from '@/components/PlaceSheet';
import { Sheet } from '@/components/Sheet';
import { TrackCard } from '@/components/TrackCard';
import { enqueuePublish } from '@/lib/publishQueue';
import { composeApi, type PhotoTag } from '@/lib/api.compose';
import { type Track } from '@/lib/api.music';
import { clearDraft, listDrafts, loadDraft, newDraftKey, saveDraft, type DraftItem } from '@/lib/drafts';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

const MAX_PHOTOS = 10;
const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Volta a gravar a foto em JPEG (até 2048 px no lado maior): serve para HEIC/HEIF do iPhone e para fotos pesadas. Devolve null se não der. */
async function toJpeg(f: File): Promise<File | null> {
  if (typeof document === 'undefined') return null;
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = document.createElement('img');
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('img'));
      i.src = url;
    });
    if (img.decode) await img.decode().catch(() => undefined);
    if (!img.naturalWidth || !img.naturalHeight) return null;
    // Tenta em tamanhos decrescentes até caber no limite (fotos enormes do iPhone, panorâmicas…).
    for (const [max, q] of [[2048, 0.88], [1600, 0.82], [1280, 0.78]] as const) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const g = c.getContext('2d');
      if (!g) return null;
      g.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size > 0 && blob.size <= MAX_BYTES) return new File([blob], (f.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
interface Asset { uri: string; video: boolean; mime: string; durationMs?: number; tags: PhotoTag[] }

/** Cartão grande do primeiro passo (só no aplicativo nativo; na web o primeiro passo é a câmara ao vivo, como no site). */
function Tile({ icon, title, sub, tone, onPress }: { icon: IconName; title: string; sub: string; tone: [string, string]; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tileWrap, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityLabel={title}>
      <LinearGradient colors={tone} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
        <View style={styles.tileIcon}><Icon name={icon} size={26} color="#fff" /></View>
        <View>
          <Text style={styles.tileTitle}>{title}</Text>
          <Text style={styles.tileSub}>{sub}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

/** Lê a duração de um vídeo escolhido no browser (para o limite de 60 s). 0 = o browser não consegue ler. */
function probeDuration(uri: string): Promise<number> {
  return new Promise((done) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration * 1000) : 0);
    v.onerror = () => done(0);
    v.src = uri;
  });
}

const ASKS = ['Qual é a vibe, {n}?', 'O que se passa, {n}?', 'Conta lá, {n}, o que andas a aprontar?', 'Onde é que a malta está hoje, {n}?', 'Qual é o plano, {n}?', 'Largaste o quê hoje, {n}?', 'Tens fofoca boa, {n}?', 'Bora, {n}, solta a vibe!', 'Que bom plano é esse, {n}?'];

/**
 * Nova publicação como no site: a câmara (na web, ao vivo; no nativo, câmara/galeria/vídeo/texto) e depois o cartão para escrever,
 * com fotos, vídeo, pessoas identificadas, local, música, rascunhos e o botão de publicar no topo.
 */
export default function Compose() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const web = Platform.OS === 'web';
  const [step, setStep] = useState<'choose' | 'write'>('choose');
  const [body, setBody] = useState('');
  const [place, setPlace] = useState('');
  const [placeGeo, setPlaceGeo] = useState<PlaceGeo | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [music, setMusic] = useState<Track | null>(null);
  const [pickMusic, setPickMusic] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [tagging, setTagging] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const { draft } = useLocalSearchParams<{ draft?: string }>();
  const draftKey = useRef(draft || newDraftKey(user?.username ?? 'eu'));
  const settled = useRef(false);
  const first = user?.displayName.split(' ')[0] ?? '';
  const [ask] = useState(() => ASKS[Math.floor(Math.random() * ASKS.length)].replace('{n}', first));

  const video = assets.find((a) => a.video);
  const photos = assets.filter((a) => !a.video);
  const hasContent = body.trim().length > 0 || assets.length > 0;
  const canPost = !busy && hasContent;
  const left = 2000 - body.length;

  const refreshDrafts = () => {
    if (user) void listDrafts(user.username).then((l) => setDrafts(l.filter((d) => d.key !== draftKey.current))).catch(() => undefined);
  };
  useEffect(refreshDrafts, [user, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapshot = () => ({ body, place, photos: assets.map((a) => ({ uri: a.uri, video: a.video, mime: a.mime, durationMs: a.durationMs })), tags: assets.map((a) => a.tags) });

  // Vindo dos rascunhos: preenche o que estava guardado.
  useEffect(() => {
    if (!draft) return;
    void loadDraft(draft).then((d) => d && applyDraft(d));
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  function applyDraft(d: DraftItem) {
    draftKey.current = d.key;
    setBody(d.body);
    setPlace(d.place);
    setPlaceGeo(null);
    setAssets(d.photos.map((p, i) => ({ uri: p.uri, video: !!p.video, mime: p.mime ?? (p.video ? 'video/mp4' : 'image/jpeg'), durationMs: p.durationMs, tags: d.tags?.[i] ?? [] })));
    setRestored(true);
    setStep('write');
  }

  // Se saíres por outro caminho (menu, voltar), o que escreveste fica guardado em vez de se perder.
  const latest = useRef({ hasContent, snapshot });
  latest.current = { hasContent, snapshot };
  useEffect(() => () => {
    const l = latest.current;
    if (!settled.current && l.hasContent) void saveDraft(draftKey.current, l.snapshot());
  }, []);

  function reset() {
    setBody('');
    setAssets([]);
    setPlace('');
    setPlaceGeo(null);
    setMusic(null);
    setRestored(false);
    setStep('choose');
    draftKey.current = newDraftKey(user?.username ?? 'eu');
  }

  /** Fotos e vídeo escolhidos no browser (câmara ou galeria): mesmas regras do site. */
  async function addFiles(files: File[]) {
    let problem = '';
    const next: Asset[] = [];
    let count = assets.length;
    for (const f of files) {
      if (f.type.startsWith('video/')) {
        if (count >= MAX_PHOTOS) { problem = `Máximo de ${MAX_PHOTOS} fotos e vídeos por publicação`; continue; }
        if (f.size > 100 * 1024 * 1024) { problem = 'Vídeo pesado demais! Máximo 100 MB'; continue; }
        const uri = URL.createObjectURL(f);
        const ms = await probeDuration(uri);
        if (ms > 60_500) { URL.revokeObjectURL(uri); problem = 'O vídeo tem de ter até 60 segundos'; continue; }
        next.push({ uri, video: true, mime: f.type, durationMs: ms || undefined, tags: [] });
        count += 1;
      } else if (count >= MAX_PHOTOS) {
        problem = `Máximo de ${MAX_PHOTOS} fotos por publicação`;
        break;
      } else {
        // Fotos noutros formatos (HEIC do iPhone, etc.) ou pesadas demais: converte-se a JPEG aqui mesmo, em vez de recusar.
        let file: File = f;
        if (!IMAGE_TYPES.includes(f.type) || f.size > MAX_BYTES) {
          const conv = await toJpeg(f);
          if (!conv) { problem = `Não consegui ler a foto ${f.name || ''} (${f.type || 'tipo desconhecido'}, ${(f.size / 1048576).toFixed(1)} MB). Tenta exportá-la como JPEG.`; continue; }
          file = conv;
        }
        next.push({ uri: URL.createObjectURL(file), video: false, mime: file.type, tags: [] });
        count += 1;
      }
    }
    setErr(problem);
    if (next.length) {
      setAssets((cur) => [...cur, ...next].slice(0, MAX_PHOTOS));
      setStep('write');
    }
  }
  function shot(s: Shot) {
    if (s.video) {
      setAssets((cur) => [...cur, { uri: s.uri, video: true, mime: s.mime, durationMs: s.durationMs, tags: [] }].slice(0, MAX_PHOTOS));
      setCameraOpen(false);
      setStep('write');
    } else {
      setAssets((cur) => [...cur.filter((a) => !a.video), { uri: s.uri, video: false, mime: s.mime, tags: [] }].slice(0, MAX_PHOTOS));
    }
  }

  /** Câmara/galeria do aparelho (nativo). */
  async function add(source: 'camera' | 'library', kind: 'photo' | 'video') {
    setErr('');
    try {
      if (source === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) return setErr('Sem permissão para a câmara. Ativa-a nas definições.');
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: kind === 'video' ? ['videos'] : ['images'],
        quality: 0.85,
        videoMaxDuration: 60,
        allowsMultipleSelection: source === 'library' && kind === 'photo',
        selectionLimit: Math.max(1, MAX_PHOTOS - photos.length),
      };
      const r = await (source === 'camera' ? ImagePicker.launchCameraAsync(opts) : ImagePicker.launchImageLibraryAsync(opts));
      if (r.canceled) return;
      const next = r.assets.map((a): Asset => ({ uri: a.uri, video: a.type === 'video', mime: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg'), durationMs: a.duration ?? undefined, tags: [] }));
      setAssets((cur) => (kind === 'video' ? next.slice(0, 1) : [...cur.filter((a) => !a.video), ...next].slice(0, MAX_PHOTOS)));
      setStep('write');
    } catch (e) {
      setErr((e as Error).message || 'Não consegui abrir a câmara');
    }
  }

  // Foto/Vídeo dentro do cartão: na web abre a câmara ao vivo; no nativo pergunta câmara ou galeria.
  const pickPhoto = () => (web && liveCameraSupported() ? setCameraOpen(true) : setSourceOpen(true));
  function pickVideo() {
    if (web && liveCameraSupported()) setCameraOpen(true);
    else void add('library', 'video');
  }

  function leave() {
    if (step === 'write' && hasContent) return setLeaveOpen(true);
    if (step === 'write') return setStep('choose');
    router.replace('/');
  }
  async function keepDraft() {
    await saveDraft(draftKey.current, snapshot());
    settled.current = true;
    setLeaveOpen(false);
    reset();
    router.replace('/drafts' as never);
  }
  async function discard() {
    settled.current = true;
    await clearDraft(draftKey.current);
    setLeaveOpen(false);
    reset();
    router.replace('/');
  }

  // Publicar em segundo plano: o cartão fecha já e o envio segue na fila (faixa no Início com o progresso).
  async function submit() {
    if (!canPost || busy) return;
    setBusy(true);
    setErr('');
    enqueuePublish({
      assets: assets.map((a) => ({ uri: a.uri, mime: a.mime, video: a.video })),
      post: {
        body,
        music,
        locationLabel: place || undefined,
        ...(place && placeGeo ? { locationLat: placeGeo.lat, locationLng: placeGeo.lng, locationCoarse: placeGeo.coarse } : {}),
        tags: assets.flatMap((a, index) => a.tags.map((t) => ({ index, username: t.username, x: t.x, y: t.y }))),
      },
    }, qc);
    settled.current = true;
    await clearDraft(draftKey.current);
    reset();
    setBusy(false);
    setProgress('');
    router.replace('/');
  }

  async function openDraft(d: DraftItem) {
    if (hasContent) await saveDraft(draftKey.current, snapshot());
    setDraftsOpen(false);
    applyDraft(d);
    refreshDrafts();
  }
  async function dropDraft(key: string) {
    await clearDraft(key);
    setDrafts((l) => l.filter((x) => x.key !== key));
  }

  const removeAsset = (uri: string) => setAssets((cur) => cur.filter((x) => x.uri !== uri));
  const cameraLayer = cameraOpen && (
    <View style={StyleSheet.absoluteFill}>
      <LiveCamera count={photos.length} max={MAX_PHOTOS} onShot={shot} onGallery={(f) => { void addFiles(f); setCameraOpen(false); }} onClose={() => setCameraOpen(false)} onDone={() => { setCameraOpen(false); setStep('write'); }} />
    </View>
  );

  // Primeiro passo na web: a câmara ao vivo ocupa o ecrã, com a galeria lá dentro.
  if (step === 'choose' && web && liveCameraSupported()) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <LiveCamera count={photos.length} max={MAX_PHOTOS} onShot={shot} onGallery={(f) => void addFiles(f)} onClose={() => router.replace('/')} onDone={() => setStep('write')} onText={() => setStep('write')} />
        {err ? <Text style={[styles.err, { position: 'absolute', top: insets.top + 72, left: 0, right: 0, color: '#fff' }]} accessibilityRole="alert">{err}</Text> : null}
      </View>
    );
  }

  if (step === 'choose') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
        <View style={styles.top}>
          <Pressable onPress={leave} style={styles.x} accessibilityRole="button" accessibilityLabel="Cancelar"><Icon name="x" size={24} strokeWidth={2} /></Pressable>
          <Text style={styles.title}>Nova publicação</Text>
          <View style={{ width: 44 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.hello}>O que vais partilhar, {first}?</Text>
          <Text style={styles.helloSub}>Escolhe um para começar. Podes sempre juntar mais depois.</Text>
          <View style={styles.grid}>
            <Tile icon="camera" title="Tirar foto" sub="Câmara" tone={[colors.brand, '#ff8a5b']} onPress={() => void add('camera', 'photo')} />
            <Tile icon="image" title="Galeria" sub="Até 10 fotos" tone={['#6366f1', '#a855f7']} onPress={() => void add('library', 'photo')} />
            <Tile icon="video" title="Vídeo" sub="Até 60 s" tone={['#0ea5e9', '#22d3ee']} onPress={() => void add('library', 'video')} />
            <Tile icon="pencil" title="Só texto" sub="Uma ideia, um desabafo" tone={['#18181b', '#52525b']} onPress={() => setStep('write')} />
          </View>
          {drafts.length > 0 ? (
            <Pressable onPress={() => router.push('/drafts' as never)} style={styles.draftsLink} accessibilityRole="button">
              <Icon name="file-text" size={18} color={colors.zinc800} />
              <Text style={styles.draftsText}>Rascunhos</Text>
            </Pressable>
          ) : null}
          {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        </ScrollView>
      </View>
    );
  }

  const chipOff = { opacity: 0.4 };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.top}>
        <Pressable onPress={leave} style={styles.x} accessibilityRole="button" accessibilityLabel="Cancelar"><Icon name="x" size={24} strokeWidth={2} /></Pressable>
        <Text style={styles.title}>{video && photos.length === 0 ? 'Nova tcheka' : 'Nova publicação'}</Text>
        <Pressable onPress={() => void submit()} disabled={!canPost} style={[styles.publish, !canPost && { backgroundColor: 'rgba(214,51,79,0.4)' }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" size="small" style={{ height: 28 }} /> : <Text style={styles.publishText}>Publicar</Text>}
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) }} showsVerticalScrollIndicator={false}>
        {!restored && drafts.length > 0 ? (
          <Pressable onPress={() => setDraftsOpen(true)} style={styles.draftsBar} accessibilityRole="button">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="file-text" size={18} color={colors.zinc800} /><Text style={styles.draftsText}>Rascunhos</Text></View>
            <View style={styles.badge}><Text style={styles.badgeText}>{drafts.length}</Text></View>
          </Pressable>
        ) : null}
        {restored ? (
          <View style={styles.restored}>
            <Text style={{ fontWeight: '600', color: colors.zinc800, fontSize: 14 }}>Rascunho recuperado</Text>
            <Pressable onPress={() => { void clearDraft(draftKey.current); reset(); setStep('write'); refreshDrafts(); }} accessibilityRole="button"><Text style={{ fontWeight: '700', color: colors.brand, fontSize: 14 }}>Descartar</Text></Pressable>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.who}>
            <Avatar name={user?.displayName ?? '?'} username={user?.username} size={48} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{user?.displayName}</Text>
              {place ? (
                <View style={styles.placePill}>
                  <Pressable onPress={() => setPlaceOpen(true)} style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityRole="button">
                    <Icon name="map-pin" size={16} color={colors.brand} />
                    <Text style={styles.placeText} numberOfLines={1}>{place}</Text>
                  </Pressable>
                  <Pressable onPress={() => { setPlace(''); setPlaceGeo(null); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Tirar o local"><Text style={styles.placeX}>×</Text></Pressable>
                </View>
              ) : (
                <Text style={styles.handle}>@{user?.username}</Text>
              )}
            </View>
          </View>

          <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
            <TextInput value={body} onChangeText={setBody} placeholder={ask} placeholderTextColor={colors.zinc500} multiline maxLength={2000} autoFocus={assets.length === 0} style={styles.input} accessibilityLabel="Texto da publicação" />
            {music ? (
              <View>
                <TrackCard track={music} />
                <Pressable onPress={() => setMusic(null)} style={styles.musicX} accessibilityRole="button" accessibilityLabel="Tirar a música"><Icon name="x" size={16} color={colors.zinc600} /></Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setPickMusic(true)} style={styles.musicBtn} accessibilityRole="button">
                <Icon name="music" size={16} color={colors.zinc800} />
                <Text style={styles.musicText}>Adicionar música</Text>
              </Pressable>
            )}
            {left < 200 ? <Text style={[styles.left, left < 50 && { color: colors.brand, fontWeight: '600' }]} accessibilityLiveRegion="polite">{left}</Text> : null}
          </View>

          {video ? (
            <View style={styles.video}>
              {web ? createElement('video', { src: video.uri, controls: true, playsInline: true, muted: true, preload: 'metadata', style: { width: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' } }) : (
                <View style={{ height: 220, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="play" size={48} color="#fff" solid />
                  <Text style={{ color: '#fff', marginTop: 8, fontWeight: '600' }}>Vídeo{video.durationMs ? ` · ${Math.round(video.durationMs / 1000)} s` : ''}</Text>
                </View>
              )}
              <Pressable onPress={() => removeAsset(video.uri)} style={styles.remove} accessibilityRole="button" accessibilityLabel="Tirar o vídeo"><Icon name="x" size={16} color="#fff" /></Pressable>
            </View>
          ) : null}

          {photos.length > 0 ? (
            <View style={styles.grid2}>
              {photos.map((a, i) => {
                const span = photos.length === 1 || (i === 0 && photos.length % 2 === 1);
                return (
                  <View key={a.uri} style={[styles.thumb, span ? { width: '100%', aspectRatio: photos.length === 1 ? 4 / 3 : 16 / 10 } : { width: '49%', aspectRatio: 1 }]}>
                    <Image source={{ uri: a.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`Foto ${i + 1}`} />
                    {i === 0 && photos.length > 1 ? <View style={styles.cover}><Text style={styles.coverText}>Capa</Text></View> : null}
                    <Pressable onPress={() => setTagging(assets.indexOf(a))} style={styles.tagBtn} accessibilityRole="button" accessibilityLabel={`Identificar pessoas na foto ${i + 1}`}>
                      <Icon name="users" size={16} color="#fff" />
                      <Text style={styles.tagBtnText}>{a.tags.length ? a.tags.length : 'Identificar'}</Text>
                    </Pressable>
                    <Pressable onPress={() => removeAsset(a.uri)} style={styles.remove} accessibilityRole="button" accessibilityLabel={`Tirar a foto ${i + 1}`}><Icon name="x" size={16} color="#fff" /></Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={styles.chips}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={pickPhoto} disabled={assets.length >= MAX_PHOTOS} style={[styles.chip, assets.length >= MAX_PHOTOS && chipOff]} accessibilityRole="button">
                <Icon name="camera" size={20} color={colors.zinc800} /><Text style={styles.chipText}>Foto</Text>
              </Pressable>
              <Pressable onPress={pickVideo} disabled={assets.length >= MAX_PHOTOS} style={[styles.chip, assets.length >= MAX_PHOTOS && chipOff]} accessibilityRole="button">
                <Icon name="video" size={20} color={colors.zinc800} /><Text style={styles.chipText}>Vídeo</Text>
              </Pressable>
              <Pressable onPress={() => setPlaceOpen(true)} style={styles.chip} accessibilityRole="button">
                <Icon name="map-pin" size={20} color={colors.zinc800} /><Text style={styles.chipText}>Local</Text>
              </Pressable>
            </View>
            {assets.length > 0 ? <Text style={styles.count}>{assets.length}/{MAX_PHOTOS}</Text> : null}
          </View>
        </View>

        <Text style={styles.errLine} accessibilityRole="alert">{err}</Text>
        {progress ? <Text style={styles.progress} accessibilityRole="summary">{progress}</Text> : null}
      </ScrollView>

      {cameraLayer}
      {pickMusic ? <MusicPicker hint={`${body} ${place}`} onClose={() => setPickMusic(false)} onPick={(t) => { setMusic(t); setPickMusic(false); }} /> : null}
      {placeOpen ? <PlaceSheet value={place} onChange={(v, g) => { setPlace(v); setPlaceGeo(g ?? null); }} onClose={() => setPlaceOpen(false)} /> : null}
      {tagging !== null && assets[tagging] ? (
        <PhotoTagger src={assets[tagging].uri} tags={assets[tagging].tags} onDone={(tags) => { setAssets((cur) => cur.map((a, n) => (n === tagging ? { ...a, tags } : a))); setTagging(null); }} />
      ) : null}
      {sourceOpen ? (
        <Sheet title="Adicionar foto" onClose={() => setSourceOpen(false)}>
          <View style={{ paddingHorizontal: 24, gap: 8 }}>
            <Pressable onPress={() => { setSourceOpen(false); void add('camera', 'photo'); }} style={styles.sheetBtn} accessibilityRole="button"><Icon name="camera" size={20} color={colors.zinc800} /><Text style={styles.sheetBtnText}>Tirar foto</Text></Pressable>
            <Pressable onPress={() => { setSourceOpen(false); void add('library', 'photo'); }} style={styles.sheetBtn} accessibilityRole="button"><Icon name="image" size={20} color={colors.zinc800} /><Text style={styles.sheetBtnText}>Escolher da galeria</Text></Pressable>
          </View>
        </Sheet>
      ) : null}
      {leaveOpen ? (
        <Sheet title="Sair sem publicar?" onClose={() => setLeaveOpen(false)}>
          <View style={{ paddingHorizontal: 24 }}>
            <Text style={{ marginBottom: 16, fontSize: 16, color: colors.zinc600 }}>Podes guardar isto como rascunho e continuar mais tarde</Text>
            <Pressable onPress={() => void keepDraft()} style={styles.primary} accessibilityRole="button"><Text style={styles.primaryText}>Guardar rascunho</Text></Pressable>
            <Pressable onPress={() => void discard()} style={styles.ghost} accessibilityRole="button"><Text style={[styles.ghostText, { color: colors.red600, fontWeight: '700' }]}>Descartar</Text></Pressable>
            <Pressable onPress={() => setLeaveOpen(false)} style={styles.ghost} accessibilityRole="button"><Text style={[styles.ghostText, { color: colors.zinc700 }]}>Continuar a editar</Text></Pressable>
          </View>
        </Sheet>
      ) : null}
      {draftsOpen ? (
        <Sheet title="Rascunhos" onClose={() => setDraftsOpen(false)}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}>
            {drafts.length === 0 ? <Text style={{ paddingVertical: 24, textAlign: 'center', color: colors.zinc600, fontSize: 16 }}>Sem rascunhos.</Text> : null}
            {drafts.map((d) => {
              const n = d.photos.length;
              return (
                <View key={d.key} style={styles.draftRow}>
                  <Pressable onPress={() => void openDraft(d)} style={({ pressed }) => [styles.draftOpen, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
                    {d.photos[0] ? <Image source={{ uri: d.photos[0].uri }} style={styles.draftThumb} contentFit="cover" /> : <View style={[styles.draftThumb, { backgroundColor: colors.zinc200, alignItems: 'center', justifyContent: 'center' }]}><Icon name="file-text" size={22} color={colors.zinc500} /></View>}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc800 }} numberOfLines={2}>{d.body.trim() || (n ? `${n} fotos` : 'Sem texto')}</Text>
                      <Text style={{ fontSize: 12, color: colors.zinc500 }}>{timeAgo(new Date(d.savedAt).toISOString())}{n > 0 && d.body.trim() ? ` · ${n} fotos` : ''}</Text>
                    </View>
                  </Pressable>
                  <Pressable onPress={() => void dropDraft(d.key)} style={styles.draftTrash} accessibilityRole="button" accessibilityLabel="Apagar rascunho"><Icon name="trash" size={20} color={colors.red600} /></Pressable>
                </View>
              );
            })}
          </ScrollView>
        </Sheet>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  draftsLink: { marginTop: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 18, paddingVertical: 10 },
  draftsText: { fontSize: 14, fontWeight: '600', color: colors.zinc800 },
  draftsBar: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 10 },
  badge: { borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  restored: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 16, backgroundColor: '#fffbeb', paddingHorizontal: 16, paddingVertical: 10 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4 },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  title: { fontSize: 18, fontWeight: '700', color: colors.zinc900 },
  publish: { height: 40, minWidth: 96, borderRadius: 20, backgroundColor: colors.brand, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' },
  publishText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hello: { fontSize: 28, fontWeight: '800', lineHeight: 32, color: colors.zinc900, marginTop: 8 },
  helloSub: { marginTop: 6, fontSize: 16, color: colors.zinc600, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tileWrap: { width: '48%', flexGrow: 1 },
  tile: { height: 160, borderRadius: 24, padding: 16, justifyContent: 'space-between' },
  tileIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  tileTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  tileSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  card: { marginHorizontal: 16, borderRadius: 28, backgroundColor: colors.white, boxShadow: '0 2px 16px rgba(0,0,0,0.09)', overflow: 'hidden' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20 },
  name: { fontSize: 18, fontWeight: '600', color: colors.zinc900 },
  handle: { fontSize: 14, color: colors.zinc500 },
  placePill: { marginTop: 2, alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: colors.rose50, paddingVertical: 2, paddingLeft: 10, paddingRight: 6 },
  placeText: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.brand },
  placeX: { paddingHorizontal: 6, fontSize: 16, color: colors.brand },
  input: { minHeight: 110, fontSize: 20, lineHeight: 28, color: colors.zinc900, textAlignVertical: 'top', padding: 0, outlineStyle: 'none' } as object,
  musicBtn: { marginTop: 4, alignSelf: 'flex-start', height: 40, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  musicText: { fontSize: 14, fontWeight: '600', color: colors.zinc800 },
  musicX: { position: 'absolute', right: 8, top: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
  left: { textAlign: 'right', fontSize: 12, color: colors.zinc500 },
  video: { marginHorizontal: 20, marginTop: 4, marginBottom: 8, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  thumb: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.zinc200 },
  cover: { position: 'absolute', left: 8, bottom: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 2 },
  coverText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  tagBtn: { position: 'absolute', right: 8, bottom: 8, height: 32, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10 },
  tagBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  remove: { position: 'absolute', right: 8, top: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  chips: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12 },
  chip: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: colors.zinc100 },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.zinc800 },
  count: { marginTop: 8, textAlign: 'center', fontSize: 12, color: colors.zinc500 },
  err: { marginTop: 12, paddingHorizontal: 24, textAlign: 'center', color: colors.red600 },
  errLine: { marginTop: 16, minHeight: 24, paddingHorizontal: 24, textAlign: 'center', fontSize: 16, color: colors.red600 },
  progress: { paddingHorizontal: 24, textAlign: 'center', fontSize: 16, color: colors.zinc600 },
  sheetBtn: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  sheetBtnText: { fontSize: 16, fontWeight: '600', color: colors.zinc800 },
  primary: { height: 48, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghost: { marginTop: 8, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 16, fontWeight: '600' },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, backgroundColor: '#fafafa', padding: 8, borderWidth: 1, borderColor: colors.zinc100 },
  draftOpen: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 4 },
  draftThumb: { width: 56, height: 56, borderRadius: 12 },
  draftTrash: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
});
