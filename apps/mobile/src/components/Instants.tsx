import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, uploadMedia } from '@/lib/api';
import { instantsApi, type InstantItem, type InstantViewer as Viewer } from '@/lib/api.geleira';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { CloseFriendsSheet, REACTIONS, ReactionArt } from './StoryParts';
import { CurvedCaption } from './zas/CurvedCaption';
import { squircle } from './zas/squircle';
import { useVisibleViewport } from './zas/useVisibleViewport';
import { WebZasStudio } from './zas/WebZasStudio';
import { saveZas, shareZas } from './zas/zasImage';

type Audience = 'friends' | 'close';
type Who = { username: string; displayName: string };

/** Pequena memória do aparelho (preferências do Zás): SecureStore na app, localStorage na web. Falha em silêncio. */
async function remember(key: string, value?: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      if (value !== undefined) localStorage.setItem(key, value);
      return localStorage.getItem(key);
    }
    if (value !== undefined) await SecureStore.setItemAsync(key, value);
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
/** Sem seleção/menu do sistema ao premir (a pressão longa abre o nosso menu) e a sombra do contador, como no site. */
const noSelect = (Platform.OS === 'web' ? { userSelect: 'none', WebkitTouchCallout: 'none' } : {}) as never;
const countShadow = (Platform.OS === 'web' ? { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))' } : {}) as never;
const INTRO_KEY = 'tx_instants_intro';
const AUDIENCE_KEY = 'tx_zas_audience';
const SNOOZE_KEY = 'tx_zas_snooze';

const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const hoursLeft = (iso: string) => `${Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000))}h`;
const leftLabel = (iso: string) => {
  const h = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
  return h <= 1 ? 'acaba daqui a pouco' : `acaba daqui a ${h} h`;
};

/** Qualquer ecrã (por ex. as Mensagens) pode pedir para abrir a câmara do Zás. */
const cameraListeners = new Set<() => void>();
export const openZasCamera = () => cameraListeners.forEach((l) => l());

/** Quem tem uma lista a rolar avisa aqui: a pílula do Zás encolhe (só as fotos) e volta ao parar, como no site. */
const scrollListeners = new Set<() => void>();
export const zasListScrolling = () => scrollListeners.forEach((l) => l());

/**
 * Zás (os Instants): uma foto tirada na hora, com uma legenda curta, que dura 24 h e cada pessoa vê uma só vez.
 * Só chega aos amigos próximos e a quem se segue mutuamente. Quando há Zás por ver, aparece uma mini pilha de fotos desfocadas
 * (canto de baixo, à direita, como os Instants do Instagram) com o número de novos. Pôr dentro de uma vista que ocupe o espaço
 * todo acima da barra de abas (flex: 1). Monta-se só nas Mensagens (e só uma vez, senão a câmara abria duas).
 * `collapsed`: encolhe a pilha (por ex. enquanto a lista rola). Premir e deslizar para a direita oculta-a 24 h; para a esquerda repõe.
 */
export function InstantsDock({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['instants'], queryFn: instantsApi.tray, refetchInterval: 60_000, enabled: !!user });
  // Como o atalho do Instagram: espreita a meio e sai de vez quando a lista pára de mexer.
  const [away, setAway] = useState(true);
  useEffect(() => {
    let t = setTimeout(() => setAway(false), 500);
    const onScroll = () => {
      setAway(true);
      clearTimeout(t);
      t = setTimeout(() => setAway(false), 900);
    };
    scrollListeners.add(onScroll);
    return () => {
      scrollListeners.delete(onScroll);
      clearTimeout(t);
    };
  }, []);
  const small = collapsed || away;
  // Entrada com mola (como o "rise" do site), encolher ao rolar e soneca (deslizar para a direita).
  const rise = useRef(new Animated.Value(0)).current;
  const shrink = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(shrink, { toValue: small ? 0.86 : 1, useNativeDriver: false, bounciness: 6 }).start();
  }, [small, shrink]);
  const [snoozed, setSnoozed] = useState(false);
  useEffect(() => {
    void remember(SNOOZE_KEY).then((v) => setSnoozed(Number(v) > Date.now()));
  }, []);
  const setSnooze = useRef((on: boolean) => {
    setSnoozed(on);
    void remember(SNOOZE_KEY, on ? String(Date.now() + 24 * 3_600_000) : '0');
    Animated.spring(slide, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
  }).current;
  const snoozedRef = useRef(snoozed);
  snoozedRef.current = snoozed;
  // Premir e deslizar: para a direita oculta (24 h), para a esquerda repõe.
  const reset = () => Animated.spring(slide, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderMove: (_e, g) => slide.setValue(snoozedRef.current ? Math.min(0, g.dx) : Math.max(0, g.dx)),
      onPanResponderRelease: (_e, g) => {
        if (!snoozedRef.current && g.dx > 40) setSnooze(true);
        else if (snoozedRef.current && g.dx < -30) setSnooze(false);
        else reset();
      },
      onPanResponderTerminate: () => reset(),
    }),
  ).current;
  const [mode, setMode] = useState<null | 'view' | 'cam'>(null);
  const [queue, setQueue] = useState<Who[]>([]);
  const [at, setAt] = useState(0);
  const [gridOpen, setGridOpen] = useState(false);
  useEffect(() => {
    const open = () => setMode('cam');
    cameraListeners.add(open);
    return () => void cameraListeners.delete(open);
  }, []);
  // O Zás é só para o telemóvel: no computador (web larga, como no site: 1024 px) não aparece.
  if (!user || (Platform.OS === 'web' && width >= 1024)) return null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['instants'] });
  const others = data?.others ?? [];
  const total = others.reduce((n, o) => n + o.count, 0);

  return (
    <>
      {(
        <ZasStack
          others={others}
          total={total}
          snoozed={snoozed}
          rise={rise}
          shrink={shrink}
          slide={slide}
          pan={pan.panHandlers}
          onRestore={() => setSnooze(false)}
          onOpen={() => {
            if (total === 0) return setMode('cam');
            setQueue(others.map((o) => ({ username: o.username, displayName: o.displayName })));
            setAt(0);
            setMode('view');
          }}
        />
      )}
      {gridOpen && <MyInstants username={user.username} onClose={() => { setGridOpen(false); refresh(); }} />}
      {mode === 'cam' && <InstantsHub onClose={() => { setMode(null); refresh(); }} />}
      {mode === 'view' && queue[at] && (
        <InstantViewer
          key={queue[at].username}
          who={queue[at]}
          own={false}
          onClose={() => { setMode(null); refresh(); }}
          onCamera={() => setMode('cam')}
          onGrid={() => { setMode(null); setGridOpen(true); }}
          onFinish={() => (at + 1 < queue.length ? setAt(at + 1) : setMode('cam'))}
        />
      )}
    </>
  );
}

type TrayOther = { username: string; displayName: string; hasAvatar: boolean; count: number; preview: string | null };

/** Miniatura squircle com moldura branca; desfocada (a pré-visualização já é minúscula), para não revelar a foto. */
function StackThumb({ o, w, h }: { o: TrayOther; w: number; h: number }) {
  const web = Platform.OS === 'web';
  return (
    <View style={[{ width: w, height: h, backgroundColor: '#fff', padding: 2.5 }, squircle(w)]}>
      <View style={[{ flex: 1, backgroundColor: colors.zinc200 }, squircle(w - 5)]}>
        {o.preview ? (
          <Image source={{ uri: o.preview }} style={[StyleSheet.absoluteFill, web ? ({ filter: 'blur(6px)', transform: [{ scale: 1.25 }] } as object) : null]} contentFit="cover" blurRadius={web ? 0 : 16} accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Avatar name={o.displayName} username={o.hasAvatar ? o.username : undefined} size={w - 5} />
          </View>
        )}
      </View>
    </View>
  );
}

/** A mini pilha de fotos dos Zás por ver: canto de baixo à direita (16 px de margem), a de cima é a mais recente. */
function ZasStack({ others, total, snoozed, rise, shrink, slide, pan, onOpen, onRestore }: { others: TrayOther[]; total: number; snoozed: boolean; rise: Animated.Value; shrink: Animated.Value; slide: Animated.Value; pan: object; onOpen: () => void; onRestore: () => void }) {
  const [press, setPress] = useState(false);
  useEffect(() => {
    Animated.spring(rise, { toValue: 1, useNativeDriver: false, bounciness: 10, speed: 12 }).start();
  }, [rise]);
  const W = 50;
  const H = 62;
  const layers = others.slice(0, 3).map((o, i) => ({ o, i })).reverse();
  const rot = ['-2deg', '-9deg', '8deg'];
  const dx = [0, -9, -3];
  const dy = [0, -6, -11];
  if (snoozed) {
    // Oculta: só uma aba junto à borda; tocar ou deslizar para a esquerda repõe.
    return (
      <Animated.View {...(pan as object)} style={[st.stack, { right: 0, bottom: 28, transform: [{ translateX: slide }] }]}>
        <Pressable onPress={onRestore} accessibilityRole="button" accessibilityLabel="Mostrar os Zás outra vez" style={st.edge}>
          <Icon name="bolt" size={14} solid color="#fff" />
        </Pressable>
      </Animated.View>
    );
  }
  return (
    <Animated.View
      {...(pan as object)}
      style={[st.stack, { right: 16, bottom: 16, opacity: rise, transform: [{ translateX: slide }, { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { scale: Animated.multiply(shrink, press ? 0.95 : 1) }] }]}
    >
      <Pressable
        onPress={onOpen}
        onPressIn={() => setPress(true)}
        onPressOut={() => setPress(false)}
        accessibilityRole="button"
        accessibilityLabel={total > 0 ? `Zás: ${total} por ver` : 'Mandar um Zás'}
        style={[{ width: W + 16, height: H + 16, alignItems: 'center', justifyContent: 'center' }, noSelect]}
      >
        {total === 0 ? (
          // Sem Zás por ver: um cartão escuro com a câmara, a entrada para mandar um Zás (como a pilha vazia do Instagram).
          <View style={[st.layer, { zIndex: 3, transform: [{ rotate: '-4deg' }] }]}>
            <View style={{ width: W, height: H, borderRadius: 14, backgroundColor: '#18181b', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
              <Icon name="camera" size={22} color="#fff" />
            </View>
          </View>
        ) : layers.map(({ o, i }) => (
          <View key={o.username} style={[st.layer, { zIndex: 3 - i, transform: [{ translateX: dx[i] }, { translateY: dy[i] }, { rotate: rot[i] }] }]}>
            <StackThumb o={o} w={W} h={H} />
          </View>
        ))}
        {total > 0 && <View style={st.count}>
          <Icon name="bolt" size={11} solid color="#fff" />
          <Text style={st.countText}>{total > 99 ? '99+' : total}</Text>
        </View>}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Mandar um Zás. No site a câmara é aberta no próprio ecrã; na app abre a câmara do telemóvel (sem galeria) e o Zás vai logo
 * (com 6 s para desfazer). Em cima, o cartão 3:4 com a legenda; em baixo o obturador e para quem vai.
 */
function InstantsHub({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<Audience>('friends');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [intro, setIntro] = useState(false);
  const [grid, setGrid] = useState(false);
  const [setupClose, setSetupClose] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bar = useRef(new Animated.Value(1)).current;
  const friends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });
  const tray = useQuery({ queryKey: ['instants'], queryFn: instantsApi.tray });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['instants'] });
  const [queue, setQueue] = useState<Who[] | null>(null);
  const [at, setAt] = useState(0);
  const others = tray.data?.others ?? [];

  useEffect(() => {
    void remember(INTRO_KEY).then((v) => setIntro(v !== '1'));
    void remember(AUDIENCE_KEY).then((v) => setAudience(v === 'close' ? 'close' : 'friends'));
    return () => clearTimeout(undoTimer.current);
  }, []);

  function pickAudience(a: Audience) {
    // Sem amigos próximos ainda: abre já a lista para os escolher.
    if (a === 'close' && friends.isSuccess && friends.data.length === 0) setSetupClose(true);
    setAudience(a);
    void remember(AUDIENCE_KEY, a);
  }

  /** Envia a foto (uri local ou blob:) como Zás, com 6 s para desfazer. */
  async function send(uri: string, mime: string) {
    setBusy(true);
    setErr('');
    try {
      const mediaId = await uploadMedia(uri, mime);
      const res = await instantsApi.create(mediaId, caption.trim(), audience);
      setCaption('');
      setSent(res.id);
      bar.setValue(1);
      Animated.timing(bar, { toValue: 0, duration: 6000, useNativeDriver: false }).start();
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setSent(null), 6000);
      refresh();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui tirar a foto');
    }
    setBusy(false);
  }
  /** Nativo: a câmara do telemóvel (sem galeria). Na web a câmara é a ao vivo (WebZasStudio). */
  async function shoot() {
    if (busy) return;
    setErr('');
    try {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return setErr('Preciso de acesso à câmara.');
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: false });
      const a = r.canceled ? null : r.assets[0];
      if (!a) return;
      await send(a.uri, a.mimeType ?? 'image/jpeg');
    } catch (e) {
      setErr((e as Error).message || 'Não consegui tirar a foto');
    }
  }
  async function sendBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    try {
      await send(url, 'image/jpeg');
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }
  }
  async function undo() {
    if (!sent) return;
    const id = sent;
    setSent(null);
    await instantsApi.remove(id).catch(() => undefined);
    refresh();
  }

  // Cartão 3:4 que cabe no espaço que sobra.
  const isWeb = Platform.OS === 'web';
  const vv = useVisibleViewport();
  const [editing, setEditing] = useState(false);
  const [capEdit, setCapEdit] = useState(false);
  const cardH = Math.min(520, height - insets.top - insets.bottom - 330);
  const cardW = Math.min(cardH * 0.75, width - 64);
  const sentBox = sent ? (

            <View accessibilityLiveRegion="polite" style={st.sent}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingLeft: 20, paddingRight: 8 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc900 }}>Zás enviado!</Text>
                <Pressable onPress={() => void undo()} accessibilityRole="button" style={{ height: 36, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, justifyContent: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.zinc900 }}>Desfazer</Text>
                </Pressable>
              </View>
              <Animated.View style={{ height: 4, borderRadius: 2, backgroundColor: colors.brand, width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
            </View>
          ) : null;
  const rootStyle = isWeb
    ? ({ flex: 1, backgroundColor: '#08080b', backgroundImage: 'radial-gradient(120% 60% at 50% 105%, rgba(255,92,92,.28), transparent 60%)', paddingTop: Math.max(8, insets.top), ...(vv ? { position: 'absolute', left: 0, right: 0, top: vv.top, height: vv.height } : null) } as never)
    : { flex: 1, backgroundColor: '#08080b', paddingTop: Math.max(8, insets.top) };
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={rootStyle}>
        {!isWeb && <LinearGradient colors={['transparent', 'rgba(255,92,92,0.28)']} start={{ x: 0.5, y: 0.4 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />}
        {!(isWeb && editing) && (
          <View style={st.hubTop}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar" style={st.small}><Icon name="x" size={26} color="#fff" /></Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="bolt" size={20} solid color={colors.brand} />
              <Text style={{ fontSize: 22, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.4, color: '#fff' }}>Zás</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {others.length > 0 && !isWeb && (
                <Pressable
                  onPress={() => { setQueue(others.map((o) => ({ username: o.username, displayName: o.displayName }))); setAt(0); }}
                  accessibilityRole="button"
                  accessibilityLabel="Ver os Zás que recebeste"
                  style={st.small}
                >
                  <Icon name="eye" size={23} color="#fff" />
                </Pressable>
              )}
              <Pressable onPress={() => setGrid(true)} accessibilityRole="button" accessibilityLabel="Os meus Zás" style={st.small}><Icon name="grid" size={23} color="#fff" /></Pressable>
            </View>
          </View>
        )}

        {isWeb ? (
          <WebZasStudio caption={caption} onCaption={setCaption} audience={audience} onAudience={pickAudience} busy={busy} err={err} editing={editing} onEditing={setEditing} onCapture={(b) => void sendBlob(b)} sentBox={sentBox} />
        ) : (
          <>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[st.cam, squircle(cardW), { width: cardW, height: cardW / 0.75 }]}>
            <Pressable onPress={() => void shoot()} disabled={busy} accessibilityRole="button" accessibilityLabel="Abrir a câmara" style={{ alignItems: 'center', gap: 10 }}>
              <Icon name="camera" size={44} color="rgba(255,255,255,0.7)" />
              <Text style={{ fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.7)' }}>Toca no raio para tirar o Zás</Text>
            </Pressable>
            <CurvedCaption w={cardW} h={cardW / 0.75} text={caption || 'Adicionar legenda…'} hint={!caption} caret={capEdit} caretFirst={!caption} />
            <TextInput
              value={caption}
              onChangeText={setCaption}
              onFocus={() => setCapEdit(true)}
              onBlur={() => setCapEdit(false)}
              maxLength={80}
              accessibilityLabel="Legenda"
              returnKeyType="done"
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '40%', zIndex: 5, opacity: 0, fontSize: 16 }}
            />
            {err ? <Text accessibilityRole="alert" style={st.err}>{err}</Text> : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: Math.max(16, insets.bottom) }}>
          {sentBox}
          <View style={{ alignItems: 'center' }}>
            <Pressable onPress={() => void shoot()} disabled={busy} accessibilityRole="button" accessibilityLabel="Tirar e enviar" style={[st.shutterRing, busy && { opacity: 0.5 }]}>
              <LinearGradient colors={['#ff5c5c', '#ff9a5b', '#ffd166', '#ff5c5c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <View style={st.shutterGap} />
              <View style={[st.shutter, { backgroundColor: busy ? colors.brand : '#fff' }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Icon name="bolt" size={30} solid color={colors.brand} />}
              </View>
            </Pressable>
          </View>
          {/* Para quem vai: amigos (próximos e mútuos) ou só os amigos próximos. */}
          <View style={st.seg} accessibilityRole="radiogroup" accessibilityLabel="Para quem vai">
            {([['friends', 'Amigos'], ['close', 'Próximos']] as const).map(([id, label]) => {
              const on = audience === id;
              return (
                <Pressable key={id} onPress={() => pickAudience(id)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[st.segBtn, on && { backgroundColor: id === 'close' ? '#10b981' : '#fff' }]}>
                  {id === 'close' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? '#fff' : '#34d399' }} />}
                  <Text style={{ fontSize: 14, fontWeight: '700', color: on ? (id === 'close' ? '#fff' : colors.zinc900) : 'rgba(255,255,255,0.7)' }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
          </>
        )}

        {intro && (
          <View style={st.introWrap}>
            <View style={st.intro} accessibilityViewIsModal>
              <View style={{ alignSelf: 'center', width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bolt" size={28} solid color="#fff" />
              </View>
              <Text style={{ marginTop: 12, textAlign: 'center', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, color: colors.zinc900 }}>Zás!</Text>
              <Text style={{ marginTop: 4, textAlign: 'center', fontSize: 15, fontWeight: '600', color: colors.zinc600 }}>Tirou, mandou, já foi.</Text>
              <View style={{ marginTop: 16, gap: 12 }}>
                {([
                  ['camera', 'Uma foto tirada na hora. Sem galeria e sem filtros.'],
                  ['send', 'O botão envia logo. Tens 6 segundos para desfazer.'],
                  ['eye', 'Cada pessoa vê uma só vez e depois desaparece.'],
                  ['clock', 'Dura 24 horas.'],
                  ['users', 'Vai para os teus amigos (quem se segue contigo) ou só para os Próximos.'],
                ] as const).map(([ic, text]) => (
                  <View key={ic} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' }}><Icon name={ic} size={18} /></View>
                    <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colors.zinc900 }}>{text}</Text>
                  </View>
                ))}
              </View>
              <Pressable onPress={() => { void remember(INTRO_KEY, '1'); setIntro(false); }} accessibilityRole="button" style={{ marginTop: 20, height: 48, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Percebi</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
      {setupClose && (
        <CloseFriendsSheet
          onClose={async () => {
            setSetupClose(false);
            const r = await friends.refetch();
            // Se continua sem ninguém, "Próximos" não faria sentido: volta a "Amigos".
            if (!r.data?.length) pickAudience('friends');
          }}
        />
      )}
      {grid && user && <MyInstants username={user.username} onClose={() => { setGrid(false); refresh(); }} />}
      {queue && queue[at] && (
        <InstantViewer
          key={queue[at].username}
          who={queue[at]}
          own={false}
          onClose={() => { setQueue(null); refresh(); }}
          onFinish={() => (at + 1 < queue.length ? setAt(at + 1) : (setQueue(null), refresh()))}
        />
      )}
    </Modal>
  );
}

/** Os meus Zás ativos em grelha de 3 (duram 24 h). Tocar abre-o; manter premido apaga. */
function MyInstants({ username, onClose }: { username: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<InstantItem[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [who, setWho] = useState<Viewer[] | null>(null);
  const [del, setDel] = useState<InstantItem | null>(null);
  const [menu, setMenu] = useState<InstantItem | null>(null);
  const load = useCallback(() => instantsApi.of(username).then(setItems).catch((e) => setErr((e as Error).message)), [username]);
  useEffect(() => {
    void load();
  }, [load]);
  const showWho = (id: string) => instantsApi.viewers(id).then(setWho).catch((e) => setErr((e as Error).message));
  async function confirmDelete() {
    if (!del) return;
    const id = del.id;
    setDel(null);
    try {
      await instantsApi.remove(id);
      setItems((l) => (l ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const cell = Math.floor((Math.min(width, 576) - 24 - 16) / 3);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000', paddingTop: Math.max(12, insets.top) }}>
        <View style={{ height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Voltar" style={[st.small, { position: 'absolute', left: 12, top: 0 }]}><Icon name="chevron-left" size={26} color="#fff" /></Pressable>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#fff' }}>Os meus Zás</Text>
        </View>
        {err ? <Text accessibilityRole="alert" style={{ paddingHorizontal: 16, paddingBottom: 8, textAlign: 'center', fontSize: 14, color: '#f87171' }}>{err}</Text> : null}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 112, alignSelf: 'center', width: '100%', maxWidth: 576 }}>
          {items === null ? (
            <Text style={st.dim}>A carregar…</Text>
          ) : items.length === 0 ? (
            <Text style={[st.dim, { paddingHorizontal: 32, color: 'rgba(255,255,255,0.7)' }]}>Não tens Zás ativos. Os Zás duram 24 h.</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {items.map((it) => {
                const top = it.reactions?.[0];
                return (
                  <Pressable
                    key={it.id}
                    onPress={() => setOpen(it.id)}
                    onLongPress={() => setMenu(it)}
                    delayLongPress={450}
                    {...(Platform.OS === 'web' ? ({ onContextMenu: (e: { preventDefault: () => void }) => { e.preventDefault(); setMenu(it); } } as object) : null)}
                    accessibilityRole="button"
                    accessibilityLabel={it.caption || 'Zás'}
                    style={({ pressed }) => [{ width: cell, height: Math.round(cell / 0.75), backgroundColor: colors.zinc800, transform: [{ scale: pressed ? 0.97 : 1 }], opacity: pressed ? 0.8 : 1 }, squircle(cell), noSelect]}
                  >
                    <Image source={{ uri: it.url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
                    <Pressable onPress={() => void showWho(it.id)} accessibilityRole="button" accessibilityLabel="Quem viu" style={[st.views, countShadow]}>
                      {top ? (
                        <>
                          <ReactionArt body={top.reaction} size={20} />
                          <Text style={st.viewsText}>{(it.reactions ?? []).reduce((n, r) => n + r.count, 0)}</Text>
                        </>
                      ) : (
                        <>
                          <Icon name="eye" size={14} color="#fff" />
                          <Text style={st.viewsText}>{it.views ?? 0}</Text>
                        </>
                      )}
                    </Pressable>
                    <View style={st.left}><Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>{hoursLeft(it.expiresAt)}</Text></View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
        {/* Botão flutuante: voltar à câmara para mandar outro. */}
        <Pressable onPress={onClose} accessibilityRole="button" style={[st.floating, { bottom: Math.max(24, insets.bottom) }]}>
          <Icon name="bolt" size={20} solid color={colors.brand} />
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.zinc900 }}>Mandar um Zás</Text>
        </Pressable>
        {menu && (
          <Sheet title="Zás" onClose={() => setMenu(null)}>
            <View style={{ paddingHorizontal: 24 }}>
              {(Platform.OS === 'web'
                ? ([
                    ['image', 'Guardar na galeria', 'Abre «Guardar imagem» no telemóvel.', () => void saveZas(menu, 'gallery'), false],
                    ['download', 'Descarregar', 'Ficheiro PNG com a moldura e a legenda.', () => void saveZas(menu, 'file'), false],
                    ['share', 'Partilhar', 'Manda a foto a quem quiseres.', () => void shareZas(menu), false],
                    ['trash', 'Apagar', 'Desaparece para toda a gente.', () => setDel(menu), true],
                  ] as const)
                : ([
                    ['share', 'Partilhar', 'Manda a foto a quem quiseres (ou guarda-a).', () => void shareZas(menu), false],
                    ['trash', 'Apagar', 'Desaparece para toda a gente.', () => setDel(menu), true],
                  ] as const)
              ).map(([ic, label, text, run, danger]) => (
                <Pressable
                  key={label}
                  onPress={() => { setMenu(null); run(); }}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, paddingVertical: 12, backgroundColor: pressed ? (danger ? colors.rose50 : colors.zinc100) : 'transparent' })}
                >
                  <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? colors.rose50 : colors.zinc100 }}>
                    <Icon name={ic} size={22} color={danger ? '#b91c1c' : colors.zinc800} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '600', color: danger ? '#b91c1c' : colors.zinc900 }}>{label}</Text>
                    <Text style={{ fontSize: 14, color: colors.zinc600 }}>{text}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </Sheet>
        )}
        {del && (
          <Sheet title="Apagar o Zás?" onClose={() => setDel(null)}>
            <View style={{ paddingHorizontal: 24 }}>
              <Text style={{ marginBottom: 16, fontSize: 16, lineHeight: 24, color: colors.zinc600 }}>Desaparece para toda a gente e não dá para o recuperar.</Text>
              <Pressable onPress={() => void confirmDelete()} accessibilityRole="button" style={[st.big, { backgroundColor: '#b91c1c' }]}><Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Apagar</Text></Pressable>
              <Pressable onPress={() => setDel(null)} accessibilityRole="button" style={[st.big, { marginTop: 8 }]}><Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc700 }}>Cancelar</Text></Pressable>
            </View>
          </Sheet>
        )}
        {who && <WhoSheet viewers={who} onClose={() => setWho(null)} />}
      </View>
      {open && <InstantViewer who={{ username, displayName: '' }} own startId={open} onClose={() => { setOpen(null); void load(); }} />}
    </Modal>
  );
}

function WhoSheet({ viewers, onClose }: { viewers: Viewer[]; onClose: () => void }) {
  return (
    <Sheet title="Quem viu" onClose={onClose}>
      <ScrollView style={{ paddingHorizontal: 24 }}>
        {viewers.length === 0 ? (
          <Text style={{ paddingVertical: 24, textAlign: 'center', fontSize: 16, color: colors.zinc600 }}>Ainda ninguém viu.</Text>
        ) : (
          viewers.map((v) => (
            <View key={v.username} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
              <Avatar name={v.displayName} username={v.hasAvatar ? v.username : undefined} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }}>{v.displayName}</Text>
                <Text style={{ fontSize: 14, color: colors.zinc500 }}>@{v.username} · {hm(v.at)}</Text>
              </View>
              {v.reaction ? <ReactionArt body={v.reaction} size={30} /> : null}
            </View>
          ))
        )}
      </ScrollView>
    </Sheet>
  );
}

/**
 * Ver os Zás de alguém: foto com cantos bem redondos, cada um abre-se uma só vez. Toca à direita para o seguinte e à esquerda para o anterior;
 * dois toques reagem com um brinde; arrastar para baixo fecha. Nos meus (`own`) mostra quem viu, as reações e deixa apagar.
 */
function InstantViewer({ who, own, onClose, onFinish, onCamera, onGrid, startId }: { who: Who; own: boolean; onClose: () => void; onFinish?: () => void; onCamera?: () => void; onGrid?: () => void; startId?: string }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [items, setItems] = useState<InstantItem[] | null>(null);
  const [i, setI] = useState(0);
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const [err, setErr] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const marked = useRef(new Set<string>());
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const [popId, setPopId] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const ownRef = useRef(own);
  ownRef.current = own;
  const viewersRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    instantsApi
      .of(who.username)
      .then((r) => {
        if (!r.length) return (onFinish ?? onClose)();
        setItems(r);
        const at = startId ? r.findIndex((x) => x.id === startId) : -1;
        if (at > 0) setI(at);
      })
      .catch((e) => setErr((e as Error).message));
    return () => {
      clearTimeout(noteTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
    };
  }, [who.username]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = items?.[i];
  // Ao aparecer, conta como visto (e some da faixa).
  useEffect(() => {
    if (own || !cur || marked.current.has(cur.id)) return;
    marked.current.add(cur.id);
    instantsApi.view(cur.id).catch(() => undefined);
  }, [cur, own]);

  const flash = (t: string, ms = 1500) => {
    setNote(t);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), ms);
  };

  function react(id: string) {
    if (!cur) return;
    setPopId(id);
    pop.setValue(0);
    Animated.timing(pop, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== 'web' }).start(() => setPopId(null));
    // A reação fica só no Zás (o dono vê-a em «quem viu»); só as respostas escritas vão para o chat.
    instantsApi.react(cur.id, id).then(() => flash('Reação enviada')).catch((e) => setErr((e as Error).message));
  }
  /** Toque numa metade: vai para o outro Zás; dois toques seguidos reagem com um brinde (e não mudam de Zás). */
  function tapZone(go: () => void) {
    if (own) return go();
    if (tapTimer.current != null) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      react(':brinde:');
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      go();
    }, 250);
  }
  function next() {
    if (!items) return;
    if (i + 1 >= items.length) (onFinish ?? onClose)();
    else setI(i + 1);
  }
  async function remove() {
    if (!cur) return;
    try {
      await instantsApi.remove(cur.id);
      const rest = items!.filter((x) => x.id !== cur.id);
      if (!rest.length) return onClose();
      setItems(rest);
      setI(Math.min(i, rest.length - 1));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function showViewers() {
    if (!cur) return;
    try {
      setViewers(await instantsApi.viewers(cur.id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  viewersRef.current = showViewers;
  async function sendReply() {
    const body = reply.trim();
    if (!body) return;
    setReply('');
    setErr('');
    try {
      await api.chatSend(who.username, { kind: 'text', body: `Sobre o teu Zás: ${body}` });
      flash('Enviado para as mensagens', 2000);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Arrastar para baixo fecha (o cartão acompanha o dedo).
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => (g.dy > 12 || (ownRef.current && g.dy < -12)) && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        // Nos meus Zás, deslizar para cima mostra quem viu e as reações.
        if (ownRef.current && g.dy < -60) void viewersRef.current();
        else if (g.dy > 110) closeRef.current();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: Platform.OS !== 'web', bounciness: 0 }).start();
      },
    }),
  ).current;

  const room = height - insets.top - insets.bottom - (own ? 250 : 400);
  const cardW = Math.min(Math.min(470, Math.max(200, room)) * 0.75, width - 72);
  const cardH = cardW / 0.75;
  const first = who.displayName.split(' ')[0] || who.username;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View {...pan.panHandlers} style={{ flex: 1, backgroundColor: '#000', paddingTop: Math.max(12, insets.top), transform: [{ translateY: drag }] }} accessibilityViewIsModal>
        <View style={st.vTop}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar" style={st.vBtn}><Icon name="x" size={28} color="#fff" /></Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {onGrid && <Pressable onPress={onGrid} accessibilityRole="button" accessibilityLabel="Os meus Zás" style={st.vBtn}><Icon name="grid" size={25} color="#fff" /></Pressable>}
            {onCamera && <Pressable onPress={onCamera} accessibilityRole="button" accessibilityLabel="Mandar o meu Zás" style={st.vBtn}><Icon name="camera" size={26} color="#fff" /></Pressable>}
          </View>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
          <View style={[{ width: cardW, height: cardH, backgroundColor: colors.zinc900 }, squircle(cardW)]}>
            {cur ? (
              <Image source={{ uri: cur.url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={cur.caption || 'Zás'} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                {err ? <Text style={{ color: 'rgba(255,255,255,0.7)' }}>{err}</Text> : <ActivityIndicator color="#fff" />}
              </View>
            )}
            <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 96 }} pointerEvents="none" />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.6)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 160 }} pointerEvents="none" />
            {/* Metades do cartão: anterior / seguinte. */}
            <Pressable accessibilityRole="button" accessibilityLabel="Anterior" onPress={() => tapZone(() => setI((k) => Math.max(0, k - 1)))} style={{ position: 'absolute', left: 0, top: 64, bottom: 64, width: '33%' }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Seguinte" onPress={() => tapZone(next)} style={{ position: 'absolute', right: 0, top: 64, bottom: 64, width: '67%' }} />
            {popId && (
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', opacity: pop.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }), transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.25] }) }] }]}>
                <ReactionArt body={popId} size={120} />
              </Animated.View>
            )}
            {cur?.caption ? <CurvedCaption w={cardW} h={cardH} text={cur.caption} arc="top" /> : null}
            {own && cur ? (
              <View pointerEvents="none" style={st.swipeUp}>
                <View style={{ transform: [{ rotate: '-90deg' }] }}><Icon name="chevron-right" size={20} color="rgba(255,255,255,0.85)" /></View>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)' }}>{cur.views ?? 0} viram</Text>
              </View>
            ) : null}
            {(err || note) && cur ? (
              <Text accessibilityRole={err ? 'alert' : 'text'} style={[st.toast, { backgroundColor: err ? 'rgba(220,38,38,0.9)' : 'rgba(5,150,105,0.9)' }]}>{err || note}</Text>
            ) : null}
          </View>
        </View>

        <View style={st.info}>
          <Avatar name={who.displayName || who.username} username={who.username} size={30} />
          <Text numberOfLines={1} style={{ maxWidth: '40%', fontSize: 14, fontWeight: '600', color: '#fff' }}>{own ? 'Os teus Zás' : who.username}</Text>
          {cur && (
            <Text style={{ fontSize: 14, color: own && new Date(cur.expiresAt).getTime() - Date.now() < 3 * 3_600_000 ? '#fcd34d' : 'rgba(255,255,255,0.65)', fontWeight: own && new Date(cur.expiresAt).getTime() - Date.now() < 3 * 3_600_000 ? '700' : '400' }}>
              {own ? `${hm(cur.at)} · ${leftLabel(cur.expiresAt)}` : timeAgo(cur.at).replace('Há ', '')}
            </Text>
          )}
          {items && items.length > 1 && <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>· {i + 1}/{items.length}</Text>}
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(16, insets.bottom) }}>
          {own ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              {!!cur?.reactions?.length && (
                <View accessibilityLabel="Reações" style={[st.glass, { height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }]}>
                  {cur.reactions.map((r) => (
                    <View key={r.reaction} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      <ReactionArt body={r.reaction} size={24} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>{r.count}</Text>
                    </View>
                  ))}
                </View>
              )}
              <Pressable onPress={() => void showViewers()} accessibilityRole="button" style={[st.glass, { height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24 }]}>
                <Icon name="eye" size={18} color="#fff" />
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#fff' }}>{cur?.views ?? 0} viram</Text>
              </Pressable>
              {cur && (
                <Pressable onPress={() => void saveZas(cur)} accessibilityRole="button" accessibilityLabel="Guardar na galeria" style={[st.glass, { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }]}>
                  <Icon name="download" size={20} color="#fff" />
                </Pressable>
              )}
              <Pressable onPress={() => void remove()} accessibilityRole="button" accessibilityLabel="Apagar Zás" style={[st.glass, { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }]}>
                <Icon name="trash" size={20} color="#fca5a5" />
              </Pressable>
            </View>
          ) : (
            <>
              <View accessibilityRole="toolbar" accessibilityLabel="Reagir" style={{ alignSelf: 'center', maxWidth: 320, marginBottom: 12, gap: 8 }}>
                {[REACTIONS.slice(0, 4), REACTIONS.slice(4)].map((row, k) => (
                  <View key={k} style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
                    {row.map((r) => (
                      <Pressable key={r.id} onPress={() => react(r.id)} accessibilityRole="button" accessibilityLabel={r.label} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                        <ReactionArt body={r.id} size={34} />
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
              <View style={st.replyBar}>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  maxLength={500}
                  placeholder={`Responder a ${first}…`}
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  accessibilityLabel="Responder"
                  returnKeyType="send"
                  onSubmitEditing={() => void sendReply()}
                  style={st.replyInput}
                />
                <Pressable onPress={() => void sendReply()} disabled={!reply.trim()} accessibilityRole="button" accessibilityLabel="Enviar" style={[st.send, !reply.trim() && { opacity: 0.4 }]}>
                  <Icon name="send" size={18} color="#fff" />
                </Pressable>
              </View>
            </>
          )}
        </View>
        {viewers && <WhoSheet viewers={viewers} onClose={() => setViewers(null)} />}
      </Animated.View>
    </Modal>
  );
}

const st = StyleSheet.create({
  stack: { position: 'absolute', zIndex: 20 },
  layer: { position: 'absolute', left: 8, top: 8,boxShadow: '0 6px 18px rgba(0,0,0,0.25)', borderRadius: 18 },
  count: { position: 'absolute', right: -2, top: -2, zIndex: 10, minWidth: 28, height: 24, borderRadius: 12, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: colors.brand, boxShadow: '0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,0.25)' },
  countText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  edge: { width: 22, height: 54, borderTopLeftRadius: 16, borderBottomLeftRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.25)' },
  hubTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  small: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  cam: { borderRadius: 52, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#18181b' },
  err: { position: 'absolute', left: 32, right: 32, bottom: 24, overflow: 'hidden', borderRadius: 22, backgroundColor: 'rgba(220,38,38,0.9)', paddingHorizontal: 16, paddingVertical: 8, textAlign: 'center', fontSize: 14, fontWeight: '600', color: '#fff' },
  sent: { alignSelf: 'center', width: '100%', maxWidth: 384, marginBottom: 12, overflow: 'hidden', borderRadius: 28, backgroundColor: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' },
  shutterRing: { width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  shutterGap: { position: 'absolute', left: 4, top: 4, right: 4, bottom: 4, borderRadius: 39, backgroundColor: '#08080b' },
  shutter: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 20px rgba(255,92,92,0.45)' },
  seg: { alignSelf: 'center', marginTop: 20, flexDirection: 'row', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', padding: 4 },
  segBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 8 },
  introWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 24 },
  intro: { width: '100%', maxWidth: 384, borderRadius: 36, backgroundColor: '#fff', padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' },
  dim: { paddingVertical: 64, textAlign: 'center', fontSize: 16, color: 'rgba(255,255,255,0.6)' },
  views: { position: 'absolute', right: '10%', top: '6%', minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 999, paddingHorizontal: 6 },
  viewsText: { fontSize: 13, fontWeight: '700', color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.9)' } as never,
  left: { position: 'absolute', bottom: '9%', right: '13%', borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 2 },
  floating: { position: 'absolute', alignSelf: 'center', height: 56, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: '#fff', paddingHorizontal: 28, boxShadow: '0 6px 24px rgba(0,0,0,0.5)' },
  big: { height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  vTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  vBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  swipeUp: { position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' },
  toast: { position: 'absolute', left: 32, right: 32, top: 24, overflow: 'hidden', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, textAlign: 'center', fontSize: 14, fontWeight: '600', color: '#fff' },
  info: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  glass: { borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)' },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', padding: 6, paddingLeft: 20 },
  replyInput: { flex: 1, minWidth: 0, fontSize: 16, color: '#fff', paddingVertical: 0, outlineStyle: 'none' } as never,
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
