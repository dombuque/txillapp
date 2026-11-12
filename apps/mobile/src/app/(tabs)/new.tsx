import { gpsFromExif, gpsFromFile, type PhotoGps } from '@/lib/photoGps';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { VenueLogo } from '@/components/VenueCard';
import { locaisApi } from '@/lib/api.locais';
import { VideoPreview } from '@/components/CarouselVideo';
import { GalleryPicker } from '@/components/GalleryPicker';
import { inAppGalleryFor } from '@/lib/mediaAccess';
import { NativeCamera } from '@/components/NativeCamera';
import { PhotoEditor } from '@/components/PhotoEditor';
import { Icon, type IconName } from '@/components/Icon';
import { LiveCamera, liveCameraSupported, type Shot } from '@/components/LiveCamera';
import { MusicPicker } from '@/components/MusicPicker';
import { MentionSuggest, useMentionSuggest } from '@/components/MentionSuggest';
import { PhotoTagger } from '@/components/PhotoTagger';
import { PlaceSheet, type PlaceGeo } from '@/components/PlaceSheet';
import { Sheet } from '@/components/Sheet';
import { TrackCard } from '@/components/TrackCard';
import { enqueuePublish } from '@/lib/publishQueue';
import { InstantsHub } from '@/components/Instants';
import { TchekaStudio, type StudioDraftIn } from '@/components/TchekaStudio';
import { StudioDrafts } from '@/components/studio/StudioDrafts';
import { newDraftId, studioDrafts, type StudioDraft } from '@/lib/studio/drafts';
import { normalizeClips } from '@/lib/studio/project';
import { PhotoViewer } from '@/components/PhotoViewer';
import { composeApi, type PhotoTag } from '@/lib/api.compose';
import { type Track } from '@/lib/api.music';
import { api } from '@/lib/api';
import { abs } from '@/lib/config';
import { soundForPost, soundTrack, type Sound } from '@/lib/soundTrack';
import { soundsApi } from '@/lib/api.sounds';
import { checkTcheka, finalMs } from '@/lib/tchekaRules';
import { clearDraft, listDrafts, loadDraft, newDraftKey, saveDraft, type DraftItem } from '@/lib/drafts';
import { useAuth } from '@/lib/auth';
import { cropToRatio, imageRatio } from '@/lib/cropToRatio';
import { editedPhoto, mimoParams } from '@/lib/signedMedia';
import { clampPostRatio } from '@/lib/postAspect';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

const MAX_PHOTOS = 10;
/** Numa tcheka gravam-se vários clipes (como no TikTok): o estúdio junta-os num vídeo só. */
const MAX_CLIPS = 30;
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
/**
 * `ratio`: proporção (largura/altura) já conhecida da foto, quando foi cortada aqui (poupa voltar a lê-la).
 * `signed`: já leva a assinatura do Txillapp (câmara da app, editor de fotos, estúdio de tchekas); ver lib/signedMedia.
 * `clean`: a mesma foto sem a assinatura (câmara do site numa tcheka): é a que entra no estúdio, que assina o vídeo inteiro.
 */
interface Asset { uri: string; video: boolean; mime: string; durationMs?: number; tags: PhotoTag[]; ratio?: number; signed?: boolean; clean?: string; /** Numa tcheka: velocidade da gravação (0,5× a 3×). */ speed?: number; /** Saído do estúdio de tchekas (já cumpre as regras) e o instante da capa. */ studio?: boolean; posterMs?: number }

/**
 * Carrossel como no Instagram: todas as fotos com a proporção da primeira foto da publicação (limitada entre 4:5 e 1,91:1),
 * cortadas ao centro. Se já houver fotos (`cur`), manda a primeira delas; senão, a primeira das novas (também é cortada se
 * estiver fora do intervalo, p. ex. uma captura de ecrã 9:16). Vídeos ficam como estão (o feed corta-os à vista).
 * Uma foto que não se consiga cortar segue tal como veio.
 */
async function fitCarousel(cur: Asset[], next: Asset[]): Promise<Asset[]> {
  if (!next.some((a) => !a.video)) return next;
  let target: number | null = null;
  const firstOld = cur.find((a) => !a.video);
  if (firstOld) {
    const r = firstOld.ratio ?? (await imageRatio(firstOld.uri));
    if (r) target = clampPostRatio(r, 1);
  }
  const out: Asset[] = [];
  for (const a of next) {
    if (a.video) { out.push(a); continue; }
    if (target === null) {
      const r = await imageRatio(a.uri);
      if (r) target = clampPostRatio(r, 1);
    }
    if (target === null) { out.push(a); continue; }
    const uri = await cropToRatio(a.uri, target);
    if (uri === a.uri) { out.push(a); continue; }
    // Na web a foto original era um URL de objeto só nosso: liberta-se a memória.
    if (Platform.OS === 'web' && a.uri.startsWith('blob:')) URL.revokeObjectURL(a.uri);
    // Cortada ao centro, a assinatura do canto pode ter ficado de fora: deixa de contar como assinada (o servidor assina).
    out.push({ ...a, uri, mime: 'image/jpeg', ratio: target, signed: undefined });
  }
  return out;
}

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

/** O servidor aceita MP4, MOV e WebM e converte tudo para MP4; outros tipos (m4v, 3gp, sem tipo) vão como MP4, como no site. */
const videoMime = (t?: string | null) => (t && ['video/mp4', 'video/quicktime', 'video/webm'].includes(t) ? t : 'video/mp4');

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
  /** Onde a primeira foto foi tirada (GPS dos metadados): só serve para sugerir o local. */
  const [photoAt, setPhotoAt] = useState<PhotoGps | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  /** Fotos a ser cortadas para a proporção do carrossel (lotes em curso). */
  const [preparing, setPreparing] = useState(0);
  const batchGen = useRef(0);
  // @ na legenda: sugere as pessoas mais próximas (a lista aparece logo por cima do campo).
  const bodyRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const mention = useMentionSuggest({ text: body, setText: setBody, inputRef: bodyRef });
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [music, setMusic] = useState<Track | null>(null);
  const [pickMusic, setPickMusic] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // O separador Criar fica montado quando se vai para outro separador: sem isto a câmara continuava ligada (o indicador
  // da câmara no iPhone e no Android ficava aceso). Fora de foco, a câmara é desmontada e desliga-se.
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  // A ordem dos modos segue o que a pessoa mais usa (conta-se cada vez que avança num modo; fica no aparelho).
  const KINDS_BASE = [{ id: 'post', label: 'Publicação' }, { id: 'mimo', label: 'Mimo' }, { id: 'tcheka', label: 'Tcheka' }, { id: 'zas', label: 'Zás' }];
  const [kindUse, setKindUse] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem('tx_kind_use') ?? '{}') as Record<string, number>; } catch { return {}; } });
  // O Zás fica sempre em último (nunca é a primeira coisa da câmara); os outros seguem o uso.
  const kinds = [...KINDS_BASE.filter((k) => k.id !== 'zas').sort((a, b) => (kindUse[b.id] ?? 0) - (kindUse[a.id] ?? 0)), KINDS_BASE.find((k) => k.id === 'zas')!];
  // A câmara abre sempre em Mimo (como as stories no Instagram).
  const [kindSel, setKindSel] = useState('mimo');
  /** No telemóvel, Publicação abre a galeria; a câmara só a partir do primeiro quadrado. */
  const [postCam, setPostCam] = useState(false);
  const [editUri, setEditUri] = useState<string | null>(null);
  const zasCounted = useRef(false);
  const bumpKind = (k: string) => setKindUse((u) => { const n = { ...u, [k]: (u[k] ?? 0) + 1 }; try { localStorage.setItem('tx_kind_use', JSON.stringify(n)); } catch { /* sem armazenamento */ } return n; });
  // Tcheka: as fotos e vídeos juntam-se e o estúdio monta um vídeo só (filtro e música).
  const [studio, setStudio] = useState(false);
  /** Rascunhos do estúdio (guardados sozinhos a cada mudança, no IndexedDB): «Continuar o rascunho?» ao entrar em Tcheka. */
  const [studioOffer, setStudioOffer] = useState<StudioDraft[] | null>(null);
  const studioOffered = useRef(false);
  const [studioDraft, setStudioDraft] = useState<StudioDraftIn | null>(null);
  const studioDraftId = useRef(newDraftId());
  const [sourceOpen, setSourceOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [tagging, setTagging] = useState<number | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  /** Largura útil da grelha de fotos (medida): no Android, `width: '%'` + `aspectRatio` num `flexWrap` dava altura 0 e as fotos não apareciam. */
  const [gridW, setGridW] = useState(0);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const { draft, kind: kindParam, t: kindNonce, as: asParam, som: somParam, dueto: duetoParam } = useLocalSearchParams<{ draft?: string; kind?: string; t?: string; as?: string; som?: string; dueto?: string }>();
  /** Um som de outra tcheka (`/tcheka/nova?som=<id>`): entra como a música do estúdio e a publicação leva o `soundId`. */
  const [sound, setSound] = useState<Sound | null>(null);
  /** Dueto (`/tcheka/nova?dueto=<postId>`): o vídeo de referência que fica ao lado no estúdio (a montagem é da equipa do remix). */
  const [duet, setDuet] = useState<{ uri: string } | null>(null);
  useEffect(() => {
    if (kindParam === 'tcheka' || somParam || duetoParam) { setKindSel('tcheka'); setStep('choose'); }
    if (somParam) {
      void soundsApi.get(String(somParam)).then((s) => { setSound(s); setMusic(soundTrack(s)); }).catch(() => setErr('Não consegui abrir este som'));
    }
    if (duetoParam) {
      void api.getPost(String(duetoParam)).then((p) => { const v = p.media.find((m) => m.kind === 'video'); if (v) setDuet({ uri: abs(v.url) ?? v.url }); }).catch(() => undefined);
    }
  }, [kindParam, somParam, duetoParam, kindNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Publicar como um local que giro (página): a lista das minhas páginas e a escolhida (`?as=slug` vem da própria página).
  const myPages = useQuery({ queryKey: ['venues-mine'], queryFn: locaisApi.myVenues, staleTime: 60_000, retry: false });
  const [asVenue, setAsVenue] = useState<string | null>(null);
  // Vindo da página do local ("Publicar"): é uma publicação da página, direto à escrita (foto ou vídeo juntam-se lá).
  useEffect(() => { if (asParam) { setAsVenue(String(asParam)); setKindSel('post'); setStep('write'); } }, [asParam]); // eslint-disable-line react-hooks/exhaustive-deps
  const pageSel = myPages.data?.find((p) => p.slug === asVenue && p.canPost) ?? null;
  // Vindo do atalho "Zás" (barra lateral no computador): abre logo o ecrã do Zás.
  useEffect(() => { if (kindParam === 'zas') setKindSel('zas'); }, [kindParam, kindNonce]);
  const draftKey = useRef(draft || newDraftKey(user?.username ?? 'eu'));
  const settled = useRef(false);
  const first = user?.displayName.split(' ')[0] ?? '';
  const [ask] = useState(() => ASKS[Math.floor(Math.random() * ASKS.length)].replace('{n}', first));

  const video = assets.find((a) => a.video);
  const photos = assets.filter((a) => !a.video);
  const hasContent = body.trim().length > 0 || assets.length > 0;
  /** Uma tcheka feita sem o estúdio (no telemóvel): as mesmas regras mínimas antes de publicar. */
  const tchekaRules = kindSel === 'tcheka' && assets.length > 0 && !assets.some((a) => a.studio)
    ? checkTcheka({ clips: assets.map((a) => ({ video: a.video, seconds: a.video ? finalMs(a.durationMs ?? 3000, a.speed ?? 1) / 1000 : 3 })), music: !!music })
    : null;
  const canPost = !busy && preparing === 0 && hasContent && (!tchekaRules || tchekaRules.ok);
  const left = 2000 - body.length;

  const refreshDrafts = () => {
    if (user) void listDrafts(user.username).then((l) => setDrafts(l.filter((d) => d.key !== draftKey.current))).catch(() => undefined);
  };
  useEffect(refreshDrafts, [user, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapshot = () => ({ body, place, photos: assets.map((a) => ({ uri: a.uri, video: a.video, mime: a.mime, durationMs: a.durationMs, signed: a.signed })), tags: assets.map((a) => a.tags) });

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
    setAssets(d.photos.map((p, i) => ({ uri: p.uri, video: !!p.video, mime: p.mime ?? (p.video ? 'video/mp4' : 'image/jpeg'), durationMs: p.durationMs, signed: p.signed, tags: d.tags?.[i] ?? [] })));
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
    setStudioDraft(null);
    studioDraftId.current = newDraftId();
    setAssets([]);
    setPlace('');
    setPlaceGeo(null);
    setPhotoAt(null);
    setMusic(null);
    setSound(null);
    setDuet(null);
    setRestored(false);
    setStep('choose');
    draftKey.current = newDraftKey(user?.username ?? 'eu');
    batchGen.current += 1; // fotos ainda a preparar já não entram
    setPreparing(0);
  }

  /**
   * Junta fotos e vídeos à publicação. Numa publicação (`crop`), as fotos são cortadas para a proporção do carrossel antes de
   * entrar (enquanto isso aparece "A preparar as fotos…" e Publicar espera). Mimos, tchekas e Zás não passam por aqui com `crop`.
   */
  async function appendAssets(next: Asset[], crop: boolean) {
    const room = next.slice(0, Math.max(0, MAX_PHOTOS - assets.length));
    if (!crop || !room.some((a) => !a.video)) {
      setAssets((cur) => [...cur, ...next].slice(0, MAX_PHOTOS));
      return;
    }
    const gen = batchGen.current;
    setPreparing((n) => n + 1);
    let fitted = room;
    try { fitted = await fitCarousel(assets, room); } catch { /* segue com as originais */ }
    if (gen !== batchGen.current) return;
    setAssets((cur) => [...cur, ...fitted].slice(0, MAX_PHOTOS));
    setPreparing((n) => Math.max(0, n - 1));
  }
  /** As fotos juntadas agora vão para uma publicação (carrossel)? Não num mimo/tcheka/Zás a ser montado na câmara. */
  const postFlow = () => step === 'write' || kindSel === 'post' || (web && !liveCameraSupported());

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
        next.push({ uri, video: true, mime: videoMime(f.type), durationMs: ms || undefined, tags: [] });
        count += 1;
      } else if (count >= MAX_PHOTOS) {
        problem = `Máximo de ${MAX_PHOTOS} fotos por publicação`;
        break;
      } else {
        // Onde foi tirada (lido antes de converter, que apaga os metadados).
        if (!photoAt) { const g = await gpsFromFile(f); if (g) setPhotoAt(g); }
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
      // Fotos e vídeos podem ir juntos na mesma publicação (carrossel), até 10, com as fotos na proporção da primeira.
      void appendAssets(next, postFlow());
      if (kindSel !== 'tcheka') setStep('write');
    }
  }
  // Mimo: a foto ou vídeo vai direto ao editor do mimo (o URL do ficheiro vale dentro da app). Zás: abre o ecrã do Zás no lugar da câmara.
  function routeByKind(s: Shot): boolean {
    if (kindSel === 'mimo') {
      bumpKind('mimo');
      router.replace({ pathname: '/stories/new', params: mimoParams(s) } as never);
      return true;
    }
    return false;
  }
  function shot(s: Shot) {
    // No cartão da publicação (passo de escrever, p. ex. vindo de Mimo ou Tcheka pelo botão Texto) a câmara é da publicação:
    // a foto junta-se a ela, não vai para o editor do mimo nem fica a juntar para o estúdio da tcheka.
    const inPost = step === 'write';
    if (!inPost && routeByKind(s)) return;
    // Na web, numa tcheka juntam-se as fotos e vídeos na câmara (o estúdio monta-os); no telemóvel segue logo para a publicação.
    const collect = kindSel === 'tcheka' && web && !inPost;
    const cap = collect ? MAX_CLIPS : MAX_PHOTOS;
    if (s.video) {
      const v: Asset = { uri: s.uri, video: true, mime: videoMime(s.mime), durationMs: s.durationMs, tags: [], signed: s.signed, ...(s.speed && s.speed !== 1 ? { speed: s.speed } : {}) };
      setAssets((cur) => [...cur, v].slice(0, cap));
      if (!collect) { bumpKind(kindSel); setCameraOpen(false); setStep('write'); }
    } else {
      // Numa publicação a foto junta-se às outras (fotos e vídeos) e vai-se logo para a publicação.
      setAssets((cur) => [...cur, { uri: s.uri, video: false, mime: s.mime, tags: [], signed: s.signed, clean: s.clean }].slice(0, cap));
      if (!collect) { bumpKind(kindSel); setCameraOpen(false); setStep('write'); }
    }
  }

  /** Várias fotos e vídeos escolhidos de uma vez na galeria da app: juntam-se à publicação (fotos na proporção da primeira). */
  function pickMany(list: Shot[]) {
    const ok = list.filter((x) => !x.video || !x.durationMs || x.durationMs <= 60_500);
    void appendAssets(ok.map((x): Asset => ({ uri: x.uri, video: x.video, mime: x.video ? videoMime(x.mime) : x.mime, durationMs: x.durationMs, tags: [] })), postFlow());
    bumpKind(kindSel);
    setCameraOpen(false);
    setStep('write');
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
        mediaTypes: kind === 'video' ? ['videos'] : source === 'library' ? ['images', 'videos'] : ['images'],
        quality: 0.85,
        videoMaxDuration: 60,
        allowsMultipleSelection: source === 'library' && kind === 'photo',
        selectionLimit: Math.max(1, MAX_PHOTOS - assets.length),
        exif: true,
      };
      const r = await (source === 'camera' ? ImagePicker.launchCameraAsync(opts) : ImagePicker.launchImageLibraryAsync(opts));
      if (r.canceled) return;
      if (!photoAt) { const g = r.assets.map((a) => gpsFromExif(a.exif as Record<string, unknown> | null)).find(Boolean); if (g) setPhotoAt(g); }
      const next = r.assets.map((a): Asset => ({ uri: a.uri, video: a.type === 'video', mime: a.type === 'video' ? videoMime(a.mimeType) : a.mimeType ?? 'image/jpeg', durationMs: a.duration ?? undefined, tags: [] }));
      // Vídeos com mais de 60 s ficam de fora (o servidor recusa-os).
      const ok = next.filter((a) => !a.video || !a.durationMs || a.durationMs <= 60_500);
      if (ok.length < next.length) setErr('Os vídeos têm de ter até 60 segundos. Deixei de fora os mais longos.');
      if (!ok.length) return;
      void appendAssets(ok, postFlow());
      setStep('write');
    } catch (e) {
      setErr((e as Error).message || 'Não consegui abrir a câmara');
    }
  }

  // Foto/Vídeo dentro do cartão: abre a câmara do Txillapp (no browser sem câmara, pergunta câmara ou galeria).
  const pickPhoto = () => (!web || liveCameraSupported() ? setCameraOpen(true) : setSourceOpen(true));
  function pickVideo() {
    if (!web || liveCameraSupported()) setCameraOpen(true);
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
    // Com um som de outra tcheka vai o soundId (e a faixa, se o som for de uma); com música do seletor, só a música.
    const sp = soundForPost(sound, music);
    enqueuePublish({
      assets: assets.map((a) => ({ uri: a.uri, mime: a.mime, video: a.video, signed: a.signed, ...(a.posterMs != null ? { posterMs: a.posterMs } : {}) })),
      post: {
        body,
        music: sp.music,
        ...(sp.soundId ? { soundId: sp.soundId } : {}),
        locationLabel: place || undefined,
        ...(place && placeGeo ? { locationLat: placeGeo.lat, locationLng: placeGeo.lng, locationCoarse: placeGeo.coarse } : {}),
        ...(pageSel ? { venueId: pageSel.id } : {}),
        tags: assets.flatMap((a, index) => a.tags.map((t) => ({ index, username: t.username, x: t.x, y: t.y }))),
      },
    }, qc);
    settled.current = true;
    await clearDraft(draftKey.current);
    // A tcheka do estúdio foi publicada: o rascunho do estúdio já não faz falta.
    if (assets.some((a) => a.studio)) await studioDrafts().remove(studioDraftId.current).catch(() => undefined);
    reset();
    setBusy(false);
    setProgress('');
    router.replace('/');
  }

  // Ao entrar em Tcheka (na câmara do site, ainda sem clipes): se houver rascunhos do estúdio, pergunta se continua.
  useEffect(() => {
    if (!web || step !== 'choose' || kindSel !== 'tcheka' || studio || assets.length || studioOffered.current) return;
    studioOffered.current = true;
    void studioDrafts().list().then((l) => { if (l.length) setStudioOffer(l); }).catch(() => undefined);
  }, [kindSel, step, studio, assets.length]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Abre um rascunho do estúdio: os clipes (com os ficheiros guardados), o resto do estúdio e o som ou o dueto de onde veio. */
  async function continueStudioDraft(d: StudioDraft) {
    setStudioOffer(null);
    const got = await studioDrafts().load(d.id).catch(() => null);
    const clips = got ? normalizeClips(got.clips) : [];
    if (!got || !clips.length) { got?.clips.forEach((c) => { if (c.uri.startsWith('blob:')) URL.revokeObjectURL(c.uri); }); setErr('Não consegui abrir o rascunho'); return; }
    const ctx = got.draft.context ?? {};
    if (typeof ctx.soundId === 'string') void soundsApi.get(ctx.soundId).then(setSound).catch(() => undefined);
    if (typeof ctx.dueto === 'string') void api.getPost(ctx.dueto).then((p) => { const v = p.media.find((m) => m.kind === 'video'); if (v) setDuet({ uri: abs(v.url) ?? v.url }); }).catch(() => undefined);
    studioDraftId.current = d.id;
    setStudioDraft({ id: d.id, clips, settings: got.draft.settings });
    setKindSel('tcheka');
    setStudio(true);
  }
  /**
   * Os clipes da câmara já montados pelo estúdio deixam de fazer falta (o vídeo que sai é outro): os URLs deles libertam-se,
   * depois de o rascunho do estúdio acabar de guardar (pode ainda estar a ler algum).
   */
  function releaseClipUrls(list: Asset[], keep: string) {
    setTimeout(() => {
      void studioDrafts().idle().then(() => {
        for (const a of list) for (const u of [a.uri, a.clean]) if (u && u !== keep && u.startsWith('blob:')) { try { URL.revokeObjectURL(u); } catch { /* já livre */ } }
      });
    }, 1500);
  }
  async function dropStudioDraft(id: string) {
    await studioDrafts().remove(id).catch(() => undefined);
    setStudioOffer((l) => { const n = (l ?? []).filter((x) => x.id !== id); return n.length ? n : null; });
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
  // Só aparece no cartão da publicação (passo de escrever): é sempre a câmara da publicação, em 4:5.
  const cameraLayer = cameraOpen && focused && (
    <View style={StyleSheet.absoluteFill}>
      {web ? (
        <LiveCamera count={assets.length} max={MAX_PHOTOS} onShot={shot} onGallery={(f) => { void addFiles(f); setCameraOpen(false); }} onClose={() => setCameraOpen(false)} onDone={() => { setCameraOpen(false); setStep('write'); }} aspect={4 / 5} />
      ) : (
        <NativeCamera onShot={shot} multi onPickMany={pickMany} galleryTitle="Nova publicação" onClose={() => setCameraOpen(false)} aspect={4 / 5} />
      )}
    </View>
  );

  // Noutro separador: nada de câmara ligada.
  if (step === 'choose' && !focused) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  // Primeiro passo na web: a câmara ao vivo ocupa o ecrã, com a galeria lá dentro.
  if (step === 'choose' && web && liveCameraSupported()) {
    // Zás: o ecrã do Zás entra no lugar da câmara (fechar volta à câmara em Publicação).
    if (kindSel === 'zas') return <View style={{ flex: 1, backgroundColor: '#000' }}><InstantsHub onClose={() => setKindSel(kinds.find((k) => k.id !== 'zas')!.id)} /></View>;
    if (studio) {
      return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <TchekaStudio
            clips={assets.map((a) => ({ uri: a.clean ?? a.uri, video: a.video, mime: a.mime, durationMs: a.durationMs, speed: a.speed }))}
            initialMusic={music}
            reference={duet}
            draft={studioDraft}
            draftId={studioDraftId.current}
            draftContext={{ ...(sound ? { soundId: sound.id } : {}), ...(duetoParam ? { dueto: String(duetoParam) } : {}) }}
            onClose={() => { setStudio(false); if (studioDraft) { setStudioDraft(null); studioDraftId.current = newDraftId(); } }}
            onDone={(s, m) => { setAssets([{ uri: s.uri, video: true, mime: s.mime, durationMs: s.durationMs, tags: [], signed: s.signed, studio: true, posterMs: s.posterMs }]); setMusic(m); setStudio(false); setStep('write'); releaseClipUrls(assets, s.uri); }}
          />
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <LiveCamera
          count={assets.length}
          max={kindSel === 'tcheka' ? MAX_CLIPS : MAX_PHOTOS}
          onShot={shot}
          onGallery={(f) => {
            const first = f[0];
            if (first && kindSel === 'mimo') { const video = first.type.startsWith('video/'); return routeByKind({ uri: URL.createObjectURL(first), video, mime: video ? videoMime(first.type) : first.type || 'image/jpeg' }); }
            void addFiles(f);
          }}
          onClose={() => router.replace('/')}
          onDone={() => { bumpKind(kindSel); if (kindSel === 'tcheka') { if (assets.some((a) => a.studio)) studioDraftId.current = newDraftId(); setStudio(true); } else setStep('write'); }}
          onText={() => setStep('write')}
          doneLabel={kindSel === 'tcheka' ? 'Montar' : 'Seguinte'}
          aspect={kindSel === 'post' ? 4 / 5 : 9 / 16}
          keepClean={kindSel === 'tcheka'}
          segmented={kindSel === 'tcheka' ? {
            clipsMs: assets.map((a) => (a.video ? finalMs(a.durationMs ?? 0, a.speed ?? 1) : 3000)),
            onUndo: () => setAssets((cur) => cur.slice(0, -1)),
            musicUrl: music ? abs(music.url) ?? music.url : null,
            musicTitle: music?.title ?? null,
            onMusic: () => setPickMusic(true),
          } : undefined}
          thumbs={assets.map((a) => a.uri)}
          kinds={kinds}
          kind={kindSel}
          onKind={(k) => { setKindSel(k); if (k === 'zas' && !zasCounted.current) { zasCounted.current = true; bumpKind('zas'); } }}
        />

        {err ? <Text style={[styles.err, { position: 'absolute', top: insets.top + 72, left: 0, right: 0, color: '#fff' }]} accessibilityRole="alert">{err}</Text> : null}
        {pickMusic ? <MusicPicker allowLocal onClose={() => setPickMusic(false)} onPick={(t) => { setMusic(t); setPickMusic(false); }} /> : null}
        {studioOffer && kindSel === 'tcheka' ? (
          <Sheet title="Continuar o rascunho?" dark onClose={() => setStudioOffer(null)}>
            <StudioDrafts drafts={studioOffer} onContinue={(d) => void continueStudioDraft(d)} onDelete={(id) => void dropStudioDraft(id)} onNew={() => setStudioOffer(null)} />
          </Sheet>
        ) : null}
      </View>
    );
  }

  // Primeiro passo no telemóvel: a câmara do Txillapp, com os modos em baixo (como no site).
  if (step === 'choose' && !web) {
    const changeKind = (k: string) => { setKindSel(k); setPostCam(false); if (k === 'zas' && !zasCounted.current) { zasCounted.current = true; bumpKind('zas'); } };
    if (kindSel === 'zas') return <View style={{ flex: 1, backgroundColor: '#000' }}><InstantsHub onClose={() => setKindSel('mimo')} /></View>;
    // Publicação: a galeria com a primeira foto em grande (como "Nova publicação" no Instagram); uma foto vai ao editor.
    // No Android não há galeria dentro da app (Photo Picker do sistema, ver lib/mediaAccess): começa na câmara, que tem o botão da galeria.
    if (kindSel === 'post' && !postCam && inAppGalleryFor(Platform.OS)) {
      return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <GalleryPicker
            title="Nova publicação"
            preview
            multi
            kinds={kinds}
            kind={kindSel}
            onKind={changeKind}
            onCamera={() => setPostCam(true)}
            onClose={() => router.replace('/')}
            onPick={(list) => {
              const one = list.length === 1 ? list[0] : null;
              if (one && !one.video) setEditUri(one.uri);
              else pickMany(list);
            }}
          />
          {editUri ? <PhotoEditor uri={editUri} aspect={4 / 5} onCancel={() => setEditUri(null)} onDone={(file) => { setEditUri(null); shot(editedPhoto(file)); }} /> : null}
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <NativeCamera
          onShot={shot}
          multi={kindSel === 'post'}
          onPickMany={pickMany}
          galleryTitle={kindSel === 'mimo' ? 'Adicionar ao mimo' : kindSel === 'tcheka' ? 'Nova tcheka' : 'Nova publicação'}
          onClose={() => router.replace('/')}
          onText={() => setStep('write')}
          aspect={kindSel === 'post' ? 4 / 5 : 9 / 16}
          kinds={kinds}
          kind={kindSel}
          onKind={changeKind}
        />
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
            <Tile icon="image" title="Galeria" sub="Fotos e vídeos, até 10" tone={['#6366f1', '#a855f7']} onPress={() => void add('library', 'photo')} />
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }} behavior="padding">
      <View style={styles.top}>
        <Pressable onPress={leave} style={styles.x} accessibilityRole="button" accessibilityLabel="Cancelar"><Icon name="x" size={24} strokeWidth={2} /></Pressable>
        <Text style={styles.title}>{assets.length === 1 && video ? 'Nova tcheka' : 'Nova publicação'}</Text>
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
          {(myPages.data ?? []).some((p) => p.canPost) ? (
            // Tenho páginas de locais: escolho se publico como eu ou como a página.
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Publicar como">
              <Pressable onPress={() => setAsVenue(null)} accessibilityRole="radio" accessibilityState={{ selected: !pageSel }} style={[styles.asChip, !pageSel && styles.asChipOn]}>
                <Avatar name={user?.displayName ?? '?'} username={user?.username} size={22} />
                <Text style={[styles.asText, !pageSel && { color: '#fff' }]}>Eu</Text>
              </Pressable>
              {(myPages.data ?? []).filter((p) => p.canPost).map((p) => (
                <Pressable key={p.slug} onPress={() => setAsVenue(p.slug)} accessibilityRole="radio" accessibilityState={{ selected: pageSel?.slug === p.slug }} style={[styles.asChip, pageSel?.slug === p.slug && styles.asChipOn]}>
                  <VenueLogo venue={p} size={22} />
                  <Text style={[styles.asText, pageSel?.slug === p.slug && { color: '#fff' }]} numberOfLines={1}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.who}>
            {pageSel ? <VenueLogo venue={pageSel} size={48} /> : <Avatar name={user?.displayName ?? '?'} username={user?.username} size={48} />}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{pageSel ? pageSel.name : user?.displayName}</Text>
              {pageSel ? (
                <Text style={styles.handle} numberOfLines={1}>Publicar como a página · o sítio fica o próprio local</Text>
              ) : place ? (
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
            <MentionSuggest mention={mention} style={{ marginHorizontal: 0, marginBottom: 8 }} />
            <TextInput ref={bodyRef} value={body} onChangeText={setBody} {...mention.inputProps} placeholder={ask} placeholderTextColor={colors.zinc500} multiline maxLength={2000} autoFocus={assets.length === 0 && preparing === 0} style={styles.input} accessibilityLabel="Texto da publicação" />
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

          {assets.length === 1 && video ? (
            <View style={styles.video}>
              {web ? createElement('video', { src: video.uri, controls: true, playsInline: true, preload: 'metadata', style: { width: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' } }) : (
                <View style={{ height: 220, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="play" size={48} color="#fff" solid />
                  <Text style={{ color: '#fff', marginTop: 8, fontWeight: '600' }}>Vídeo{video.durationMs ? ` · ${Math.round(video.durationMs / 1000)} s` : ''}</Text>
                </View>
              )}
              <Pressable onPress={() => removeAsset(video.uri)} style={styles.remove} accessibilityRole="button" accessibilityLabel="Tirar o vídeo"><Icon name="x" size={16} color="#fff" /></Pressable>
            </View>
          ) : null}

          {assets.length > 0 && !(assets.length === 1 && video) ? (
            <View style={styles.grid2} onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width - 40); if (w > 0 && w !== gridW) setGridW(w); }}>
              {assets.map((a, i) => {
                const n = assets.length;
                const span = n === 1 || (i === 0 && n % 2 === 1);
                const photoIndex = photos.indexOf(a);
                const ratio = span ? (n === 1 ? 4 / 3 : 16 / 10) : 1;
                // Tamanho em píxeis (largura medida da grelha); antes de medir, um primeiro palpite que já não fica com altura 0.
                const tw = gridW ? (span ? gridW : Math.floor(gridW * 0.49)) : 0;
                const size = tw ? { width: tw, height: Math.round(tw / ratio) } : { width: span ? ('100%' as const) : ('49%' as const), aspectRatio: ratio };
                return (
                  <View key={a.uri} style={[styles.thumb, size]}>
                    {a.video ? (
                      <Pressable onPress={() => setPlaying(a.uri)} style={[StyleSheet.absoluteFill, { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }]} accessibilityRole="button" accessibilityLabel={`Ver o vídeo ${i + 1}`}>
                        {web ? createElement('video', { src: `${a.uri}#t=0.1`, muted: true, playsInline: true, preload: 'metadata', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' } }) : null}
                        <View style={styles.playDot}><Icon name="play" size={22} color="#fff" solid /></View>
                        {a.durationMs ? <View style={styles.dur}><Icon name="video" size={12} color="#fff" /><Text style={styles.coverText}>{Math.round(a.durationMs / 1000)} s</Text></View> : null}
                      </Pressable>
                    ) : (
                      <>
                        <Pressable onPress={() => setViewing(photoIndex)} style={StyleSheet.absoluteFill} accessibilityRole="imagebutton" accessibilityLabel={`Ver a foto ${i + 1}`}>
                          <Image source={{ uri: a.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                        </Pressable>
                        <Pressable onPress={() => setTagging(i)} style={styles.tagBtn} accessibilityRole="button" accessibilityLabel={`Identificar pessoas na foto ${i + 1}`}>
                          <Icon name="users" size={16} color="#fff" />
                          <Text style={styles.tagBtnText}>{a.tags.length ? a.tags.length : 'Identificar'}</Text>
                        </Pressable>
                      </>
                    )}
                    {i === 0 && n > 1 ? <View style={styles.cover}><Text style={styles.coverText}>Capa</Text></View> : null}
                    <Pressable onPress={() => removeAsset(a.uri)} style={styles.remove} accessibilityRole="button" accessibilityLabel={a.video ? `Tirar o vídeo ${i + 1}` : `Tirar a foto ${i + 1}`}><Icon name="x" size={16} color="#fff" /></Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}
          {preparing > 0 ? (
            <View style={styles.preparing} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.zinc500} size="small" />
              <Text style={styles.preparingText}>A preparar as fotos…</Text>
            </View>
          ) : null}
          {playing ? <VideoPreview uri={playing} onClose={() => setPlaying(null)} /> : null}

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

        {tchekaRules?.hint ? <Text style={styles.errLine} accessibilityRole="alert">Para publicar a tcheka: {tchekaRules.hint}</Text> : null}
        <Text style={styles.errLine} accessibilityRole="alert">{err}</Text>
        {progress ? <Text style={styles.progress} accessibilityRole="summary">{progress}</Text> : null}
      </ScrollView>

      {cameraLayer}
      {/* As músicas dos artistas de Moçambique só vão em tchekas (uma publicação com um só vídeo), como diz a licença. */}
      {pickMusic ? <MusicPicker hint={`${body} ${place}`} allowLocal={assets.length === 1 && assets[0].video} onClose={() => setPickMusic(false)} onPick={(t) => { setMusic(t); setPickMusic(false); }} /> : null}
      {placeOpen ? <PlaceSheet value={place} photoAt={photoAt} onChange={(v, g) => { setPlace(v); setPlaceGeo(g ?? null); }} onClose={() => setPlaceOpen(false)} /> : null}
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
      {viewing !== null && photos[viewing] ? (
        <PhotoViewer photos={photos.map((a) => ({ url: a.uri, tags: a.tags }))} start={viewing} author={{ displayName: user?.displayName ?? '', username: user?.username ?? '' }} onClose={() => setViewing(null)} />
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
  asChip: { height: 36, maxWidth: 200, borderRadius: 999, paddingLeft: 7, paddingRight: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.zinc100 },
  asChipOn: { backgroundColor: colors.zinc900 },
  asText: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: colors.zinc800 },
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
  preparing: { marginHorizontal: 20, marginTop: 4, marginBottom: 8, height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 16, backgroundColor: colors.zinc100 },
  preparingText: { fontSize: 14, fontWeight: '600', color: colors.zinc600 },
  playDot: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  dur: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4 },
  cover: { position: 'absolute', left: 8, top: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 2 },
  coverText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  tagBtn: { position: 'absolute', left: 8, bottom: 8, height: 32, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10 },
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
