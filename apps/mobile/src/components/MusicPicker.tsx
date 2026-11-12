import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator } from '@/components/PontoLoader';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { Icon } from '@/components/Icon';
import { DARK, Sheet, useSheetMode, useSheetScroll } from '@/components/Sheet';
import { musicApi, type Track } from '@/lib/api.music';
import { anchorOf, type Rect } from '@/lib/desktopKeys';
import { useDesktop } from '@/lib/desktop';
import {
  canSave,
  dropFromCache,
  forYouChips,
  forYouList,
  forYouStyle,
  highlightColors,
  highlights,
  licenseLabel,
  onlyAllowed,
  pickerTabs,
  rowMeta,
  toggleSaved,
  withoutDisliked,
  type ForYouFilter,
  type PickerTab,
} from '@/lib/musicCatalog';
import { suggestMusic } from '@/lib/musicSuggest';
import { uploadMedia } from '@/lib/api';
import { playTrack, stopTrack } from '@/lib/musicPlayer';
import { colors } from '@/lib/theme';

export { licenseLabel };

const CLIP_MAX_MS = 30_000;
/** As listas do catálogo guardadas em cache (todas perdem logo a faixa marcada com «Não gosto desta»). */
const LIST_KEYS = [['music-home'], ['music-style'], ['music-local'], ['music-sounds'], ['music-search']] as const;

/** Gravar um clipe de áudio (até 30 s) com o microfone: grava, ouve-se e usa-se. Fica privado e só é servido com URL assinado. */
function ClipRecorder({ onPick }: { onPick: (t: Track) => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const me = useRef(Symbol('clip'));
  const [state, setState] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [ms, setMs] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(false);
  const uri = useRef<string | null>(null);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => {
    clearInterval(timer.current);
    stopTrack(me.current);
    try { if (recorder.isRecording) void recorder.stop(); } catch { /* já parado */ }
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  }, [recorder]);

  async function start() {
    setErr('');
    try {
      stopTrack(me.current);
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) throw new Error('Sem permissão para o microfone. Ativa-o nas definições.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      started.current = Date.now();
      setMs(0);
      setState('recording');
      timer.current = setInterval(() => {
        const t = Date.now() - started.current;
        setMs(t);
        if (t >= CLIP_MAX_MS) void stop();
      }, 200);
    } catch (e) {
      setErr((e as Error).message || 'Este telemóvel não deixa gravar áudio aqui');
    }
  }
  async function stop() {
    clearInterval(timer.current);
    const t = Math.min(CLIP_MAX_MS, Date.now() - started.current);
    try {
      await recorder.stop();
      uri.current = recorder.uri ?? null;
    } catch {
      uri.current = null;
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    if (!uri.current) {
      setErr('Não consegui gravar');
      setState('idle');
      return;
    }
    setMs(t);
    setState('ready');
  }
  async function listen() {
    if (on) {
      stopTrack(me.current);
      return;
    }
    if (!uri.current) return;
    setOn(true);
    const ok = await playTrack(me.current, uri.current, { loop: false, onStop: () => setOn(false) });
    if (!ok) setOn(false);
  }
  async function use() {
    if (!uri.current) return;
    stopTrack(me.current);
    setBusy(true);
    setErr('');
    try {
      let mime = 'audio/mp4';
      if (Platform.OS === 'web') mime = ((await (await fetch(uri.current)).blob()).type || 'audio/webm').split(';')[0];
      const mediaId = await uploadMedia(uri.current, mime, 'chat');
      onPick({ kind: 'clip', mediaId, id: `clip:${mediaId}`, title: 'Áudio original', artist: '', url: uri.current, landing: null, license: 'own', licenseUrl: null, durationMs: Math.max(500, ms), cover: null });
    } catch (e) {
      setErr((e as Error).message || 'Não consegui enviar');
      setBusy(false);
    }
  }
  const secs = Math.floor(ms / 1000);
  return (
    <View style={s.rec}>
      <Text style={s.recTitle}>Gravar o meu áudio</Text>
      {state === 'idle' && (
        <Pressable onPress={start} style={({ pressed }) => [s.bigBtn, pressed && s.pressed]} accessibilityRole="button">
          <Icon name="mic" size={18} color="#fff" />
          <Text style={s.bigTxt}>Gravar (até 30 s)</Text>
        </Pressable>
      )}
      {state === 'recording' && (
        <Pressable onPress={stop} style={({ pressed }) => [s.bigBtn, { backgroundColor: colors.red600 }, pressed && s.pressed]} accessibilityRole="button">
          <View style={s.dot2} />
          <Text style={s.bigTxt}>A gravar {secs}s · Parar</Text>
        </Pressable>
      )}
      {state === 'ready' && (
        <View style={s.recRow}>
          <Pressable onPress={listen} style={s.listen} accessibilityRole="button" accessibilityLabel={on ? 'Parar' : 'Ouvir'}>
            <Icon name={on ? 'pause' : 'play'} size={16} solid color={colors.zinc900} />
            <Text style={s.listenTxt}>{secs}s</Text>
          </Pressable>
          <Pressable onPress={() => { stopTrack(me.current); setState('idle'); setMs(0); uri.current = null; }} style={s.again} accessibilityRole="button"><Text style={s.againTxt}>Repetir</Text></Pressable>
          <Pressable disabled={busy} onPress={use} style={({ pressed }) => [s.recUse, { flex: 1 }, busy && { opacity: 0.5 }, pressed && s.pressed]} accessibilityRole="button">
            <Text style={s.bigTxt}>{busy ? 'A enviar…' : 'Usar'}</Text>
          </Pressable>
        </View>
      )}
      {!!err && <Text style={s.err}>{err}</Text>}
    </View>
  );
}

/** As cores do seletor (a folha escura, ver Sheet `dark`). */
const C = { bg: DARK.bg, raised: '#2c2c2e', line: '#3a3a3c', text: '#ffffff', sub: '#8e8e93', soft: '#c7c7cc' } as const;
/** Fundos das capas que faltam (para as linhas sem capa não ficarem todas iguais). */
const NO_COVER = ['#3b2f4a', '#2b3d4f', '#4a2b36', '#2b4a3d', '#4a3f2b', '#33334d'] as const;
const noCover = (t: Track) => {
  if (t.coverColors) return highlightColors(t)[0];
  let h = 0;
  for (let i = 0; i < t.id.length; i++) h = (h * 31 + t.id.charCodeAt(i)) >>> 0;
  return NO_COVER[h % NO_COVER.length];
};

/**
 * Escolher a música de um mimo, de uma tcheka ou de uma nota, do catálogo curado do servidor. Folha escura de baixo (no
 * computador, painel à direita) com a pesquisa e quatro separadores: «Para ti» (destaques, as pastilhas de estilo e o que
 * combina com o texto do post e com as guardadas), «Em alta», «Sons originais» e «Guardadas». Tocar numa linha ouve um
 * pedaço; «Usar» escolhe-a; manter premido (ou o «⋯» no computador) abre o resto, como «Não gosto desta». O crédito do
 * autor segue com a faixa. As faixas dos artistas de Moçambique só aparecem com `allowLocal` (mimos, TchekaStudio e
 * publicação com um só vídeo).
 */
export function MusicPicker({ onPick, onClose, hint, allowLocal = false }: { onPick: (t: Track) => void; onClose: () => void; /** O que a pessoa escreveu (texto e local): serve para sugerir o estilo. */ hint?: string; /** Mostra os «Artistas de Moçambique» (só mimos e tchekas, como diz a licença). */ allowLocal?: boolean }) {
  return (
    <Sheet onClose={onClose} full plain dark variant="panel">
      <PickerBody onPick={onPick} hint={hint} allowLocal={allowLocal} />
    </Sheet>
  );
}

function PickerBody({ onPick, hint, allowLocal }: { onPick: (t: Track) => void; hint?: string; allowLocal: boolean }) {
  const suggestion = useMemo(() => suggestMusic(hint), [hint]);
  const me = useRef(Symbol('picker'));
  const sheetScroll = useSheetScroll();
  const mode = useSheetMode();
  const desktop = useDesktop();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [tab, setTab] = useState<PickerTab>('forYou');
  const [filter, setFilter] = useState<ForYouFilter>(null);
  // As que marquei com «Não gosto desta» enquanto o seletor está aberto (o servidor já não as manda da próxima vez).
  const [disliked, setDisliked] = useState<ReadonlySet<string>>(() => new Set());
  const [undo, setUndo] = useState<Track | null>(null);
  const [menu, setMenu] = useState<{ track: Track; anchor: Rect | null } | null>(null);

  const home = useQuery({ queryKey: ['music-home'], queryFn: musicApi.home, staleTime: 5 * 60_000, retry: false });
  const favs = useQuery({ queryKey: ['music-favorites'], queryFn: musicApi.favorites, staleTime: 60_000, retry: false });
  // «Para ti» sem pastilha vai buscar o estilo sugerido pelo texto (ou o das guardadas); com pastilha, o dessa pastilha.
  const autoStyle = forYouStyle(suggestion?.genre, favs.data);
  const styleId = tab !== 'forYou' ? null : filter === null ? autoStyle : filter.startsWith('style:') ? filter.slice(6) : null;
  const styleList = useQuery({ queryKey: ['music-style', styleId], queryFn: () => musicApi.style(styleId!), enabled: !!styleId, staleTime: 10 * 60_000, retry: false });
  const localList = useQuery({ queryKey: ['music-local'], queryFn: () => musicApi.local(), enabled: tab === 'forYou' && filter === 'local', staleTime: 10 * 60_000, retry: false });
  const soundList = useQuery({ queryKey: ['music-sounds'], queryFn: musicApi.sounds, enabled: tab === 'sounds', staleTime: 10 * 60_000, retry: false });
  const found = useQuery({ queryKey: ['music-search', query], queryFn: () => musicApi.search(query), enabled: query.length >= 2, staleTime: 5 * 60_000, retry: false });

  const savedIds = useMemo(() => new Set((favs.data ?? []).map((t) => t.id)), [favs.data]);
  const toggleSave = useMutation({
    mutationFn: (t: Track): Promise<{ favorite: boolean }> => (savedIds.has(t.id) ? musicApi.removeFavorite(t.id) : musicApi.addFavorite(t)),
    // Muda logo no ecrã; o servidor confirma.
    onMutate: (t) => qc.setQueryData<Track[]>(['music-favorites'], (old) => toggleSaved(old, t)),
    onError: (e) => {
      setErr((e as Error).message || 'Não consegui guardar');
      void qc.invalidateQueries({ queryKey: ['music-favorites'] });
    },
  });

  const refetchLists = () => { for (const k of LIST_KEYS) void qc.invalidateQueries({ queryKey: [...k] }); };
  const dislike = useMutation({
    mutationFn: (t: Track) => musicApi.dislike(t.id),
    onMutate: (t) => {
      // Sai logo de todas as listas do seletor; o servidor guarda e, quando muita gente marca, baixa-a para todos.
      if (playing === t.id) stopTrack(me.current);
      setDisliked((old) => new Set(old).add(t.id));
      setUndo(t);
      for (const k of LIST_KEYS) qc.setQueriesData({ queryKey: [...k] }, (data: unknown) => (data ? dropFromCache(data, t.id) : data));
    },
    onError: (e, t) => {
      setDisliked((old) => { const n = new Set(old); n.delete(t.id); return n; });
      setUndo(null);
      setErr((e as Error).message || 'Não consegui tirar a faixa');
      refetchLists();
    },
  });
  const undislike = useMutation({
    mutationFn: (t: Track) => musicApi.undislike(t.id),
    onMutate: (t) => {
      setDisliked((old) => { const n = new Set(old); n.delete(t.id); return n; });
      setUndo(null);
    },
    onSettled: () => refetchLists(),
  });

  // Procura meio segundo depois de parares de escrever.
  useEffect(() => {
    const typed = term.trim();
    const t = setTimeout(() => setQuery(typed.length >= 2 ? typed : ''), typed.length >= 2 ? 500 : 0);
    return () => clearTimeout(t);
  }, [term]);
  const searching = query.length >= 2;

  // Pára o som ao sair.
  useEffect(() => () => stopTrack(me.current), []);

  async function toggle(t: Track) {
    if (playing === t.id) {
      stopTrack(me.current);
      return;
    }
    setErr('');
    setPlaying(t.id);
    const ok = await playTrack(me.current, t.url, { loop: false, onStop: () => setPlaying((cur) => (cur === t.id ? null : cur)) });
    if (!ok) {
      setPlaying(null);
      setErr('Não consegui tocar');
    }
  }
  function pick(t: Track) {
    stopTrack(me.current);
    onPick(t);
  }

  const clean = (list: Track[] | null | undefined) => onlyAllowed(withoutDisliked(list, disliked), allowLocal);
  const row = (t: Track) => (
    <TrackRow
      key={t.id}
      t={t}
      active={playing === t.id}
      saved={savedIds.has(t.id)}
      desktop={desktop}
      onPlay={toggle}
      onUse={pick}
      onSave={(x) => toggleSave.mutate(x)}
      onMenu={(x, anchor) => setMenu({ track: x, anchor })}
    />
  );
  const loading = <ActivityIndicator color={C.sub} style={{ paddingVertical: 24 }} />;
  const list = (q: { isLoading: boolean; data?: Track[]; error?: unknown }, empty: string) => {
    if (q.isLoading) return loading;
    if (q.error) return <Text style={s.err}>{(q.error as Error).message || 'Não consegui abrir a música agora'}</Text>;
    const items = onlyAllowed(withoutDisliked(q.data, disliked), allowLocal);
    return items.length ? items.map(row) : <Text style={s.empty}>{empty}</Text>;
  };

  const tabs = pickerTabs();
  const chips = forYouChips(home.data, allowLocal, suggestion?.genre);
  const tops = clean(highlights(home.data, allowLocal));
  const saved = clean(favs.data);
  const forYou = forYouList({ styleTracks: filter === null ? clean(styleList.data) : [], trending: clean(home.data?.trending), recent: clean(home.data?.recent), saved, skip: tops });
  const suggestedLabel = suggestion ? home.data?.styles.find((st) => st.id === suggestion.genre)?.label : undefined;
  // A pastilha que estava escolhida deixou de existir (ex.: sem artistas locais): volta ao «Para ti» todo.
  useEffect(() => {
    if (filter && home.data && !chips.some((c) => c.id === filter)) setFilter(null);
  }, [filter, home.data, chips]);

  return (
    <View style={s.body}>
      {mode !== 'bottom' ? <Text style={s.deskTitle} accessibilityRole="header">Música e sons</Text> : null}
      <View style={s.search}>
        <Icon name="search" size={18} color={C.sub} />
        <TextInput value={term} onChangeText={setTerm} placeholder="Procurar música, artista ou estilo" placeholderTextColor={C.sub} accessibilityLabel="Procurar música, artista ou estilo" autoCorrect={false} keyboardAppearance="dark" selectionColor={colors.brand} style={s.input} />
        {term ? (
          <Pressable onPress={() => setTerm('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa">
            <Icon name="x" size={16} color={C.sub} />
          </Pressable>
        ) : null}
      </View>
      {!searching ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.tabs} contentContainerStyle={s.tabsIn} accessibilityRole="tablist">
          {tabs.map(({ id, label }) => (
            <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={(st) => [s.tab, tab === id ? s.tabOn : (st as { hovered?: boolean }).hovered && s.tabHover]}>
              <Text style={[s.tabTxt, tab === id && s.tabTxtOn]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollIn}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={(e) => {
          if (sheetScroll) sheetScroll.top.current = e.nativeEvent.contentOffset.y <= 0;
        }}
      >
        {undo ? (
          <View style={s.undo} accessibilityLiveRegion="polite">
            <Text style={s.undoTxt} numberOfLines={1}>Tirada: {undo.title}.</Text>
            <Pressable onPress={() => undislike.mutate(undo)} hitSlop={6} accessibilityRole="button"><Text style={s.undoBtn}>Desfazer</Text></Pressable>
          </View>
        ) : null}
        {!!err && <Text style={s.err}>{err}</Text>}

        {searching ? (
          <View style={{ marginTop: 6 }}>{list(found, 'Nada com esse nome')}</View>
        ) : tab === 'forYou' ? (
          <>
            {filter === null && !home.isLoading ? <Highlights items={tops} playing={playing} onPlay={toggle} onUse={pick} /> : null}
            {chips.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.chips} contentContainerStyle={{ gap: 6 }}>
                {chips.map((c) => {
                  const on = filter === c.id;
                  return (
                    <Pressable key={c.id} onPress={() => setFilter(on ? null : c.id)} style={(st) => [s.chip, on && s.chipOn, !on && (st as { hovered?: boolean }).hovered && s.chipHover]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                      {c.id === 'local' ? <Icon name="map-pin" size={13} color={on ? C.bg : C.soft} /> : null}
                      <Text style={[s.chipTxt, on && { color: C.bg }]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            {filter === null ? (
              <>
                <Text style={s.h}>{suggestedLabel ? `Para o teu post · ${suggestedLabel}` : 'Sugestões para ti'}</Text>
                {home.isLoading ? loading : home.error ? <Text style={s.err}>{(home.error as Error).message || 'Não consegui abrir a música agora'}</Text> : forYou.length ? forYou.map(row) : <Text style={s.empty}>Ainda não há sugestões. Procura uma música ou vê «Em alta».</Text>}
              </>
            ) : filter === 'local' ? (
              <>
                <Text style={s.h}>Artistas de Moçambique</Text>
                {list(localList, 'Ainda não há músicas de artistas de Moçambique.')}
              </>
            ) : (
              <View style={{ marginTop: 8 }}>{list(styleList, 'Ainda não há músicas deste estilo.')}</View>
            )}
          </>
        ) : tab === 'trending' ? (
          <>
            <Text style={s.h}>Em alta no Txillapp</Text>
            {list({ isLoading: home.isLoading, data: home.data?.trending, error: home.error }, 'Ainda não há músicas em alta. Vê «Para ti» ou pesquisa.')}
          </>
        ) : tab === 'sounds' ? (
          <View style={{ marginTop: 8 }}>{list(soundList, 'Ainda não há sons originais.')}</View>
        ) : (
          <View style={{ marginTop: 8 }}>
            {favs.isLoading ? loading : saved.length ? saved.map(row) : <Text style={s.empty}>Ainda não guardaste nenhuma. Toca no marcador de uma faixa para a guardares aqui.</Text>}
          </View>
        )}
        <Text style={s.note}>
          Só músicas que se podem pôr em vídeos partilhados: licença aberta (CC0, domínio público ou CC BY, com o crédito de quem as fez) e artistas de Moçambique que deram autorização ao Txillapp.{' '}
          {desktop ? 'Clica numa faixa para a ouvires; no «⋯» (ou com o botão direito) há «Não gosto desta».' : 'Toca numa faixa para a ouvires; mantém-na premida para «Não gosto desta».'}
        </Text>
      </ScrollView>

      {menu ? (
        <RowMenu
          track={menu.track}
          anchor={menu.anchor}
          playing={playing === menu.track.id}
          saved={savedIds.has(menu.track.id)}
          onClose={() => setMenu(null)}
          onPlay={toggle}
          onUse={pick}
          onSave={(x) => toggleSave.mutate(x)}
          onDislike={(x) => dislike.mutate(x)}
        />
      ) : null}
    </View>
  );
}

/** A capa quadrada (ou um fundo com uma nota, sem capa); a tocar, escurece e mostra o indicador de som. */
function Cover({ t, size, radius, active }: { t: Track; size: number; radius: number; active: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: noCover(t) }}>
      {t.cover ? (
        <Image source={{ uri: t.cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessible={false} />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.center]}>
          <Icon name={t.kind === 'sound' ? 'waves' : 'music'} size={Math.round(size * 0.4)} color="rgba(255,255,255,0.85)" />
        </View>
      )}
      {active ? (
        <View style={[StyleSheet.absoluteFill, s.center, s.coverDim]}>
          <SoundBars size={Math.round(size * 0.32)} />
        </View>
      ) : null}
    </View>
  );
}

/** O pequeno indicador de som (três barras a subir e a descer) da faixa que está a tocar. */
function SoundBars({ size = 16, color = '#fff' }: { size?: number; color?: string }) {
  const bars = useRef([0, 1, 2].map(() => new Animated.Value(0.35))).current;
  useEffect(() => {
    const native = Platform.OS !== 'web';
    const loops = bars.map((a, k) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(a, { toValue: 1, duration: 300 + k * 110, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
          Animated.timing(a, { toValue: 0.35, duration: 300 + k * 110, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bars]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: size, gap: Math.max(2, size / 8) }} accessibilityLabel="A tocar">
      {bars.map((a, k) => (
        <Animated.View key={k} style={{ width: Math.max(3, size / 5), height: size, borderRadius: 2, backgroundColor: color, transform: [{ scaleY: a }] }} />
      ))}
    </View>
  );
}

/**
 * Uma faixa da lista: capa, título e «Artista · 1,2 mil usos · 2:53», e o marcador de guardar à direita. Tocar ouve (a linha
 * fica realçada, com o indicador de som, e aparece «Usar»); manter premido, o botão direito ou o «⋯» (computador) abrem o resto.
 */
function TrackRow({ t, active, saved, desktop, onPlay, onUse, onSave, onMenu }: { t: Track; active: boolean; saved: boolean; desktop: boolean; onPlay: (t: Track) => void; onUse: (t: Track) => void; onSave: (t: Track) => void; onMenu: (t: Track, anchor: Rect | null) => void }) {
  const [hot, setHot] = useState(false);
  const meta = rowMeta(t);
  return (
    <Pressable
      onPress={() => onPlay(t)}
      onLongPress={() => onMenu(t, null)}
      delayLongPress={350}
      // O rato por cima (só no computador): mouseenter/mouseleave não contam a passagem para os botões de dentro.
      {...(desktop
        ? ({
            onMouseEnter: () => setHot(true),
            onMouseLeave: () => setHot(false),
            onContextMenu: (e: { preventDefault?: () => void }) => { e.preventDefault?.(); onMenu(t, anchorOf(e)); },
          } as object)
        : null)}
      style={({ pressed }) => [s.row, active ? s.rowOn : hot ? s.rowHover : null, pressed && !active && s.rowPressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${t.title}. ${meta}. ${active ? 'A tocar' : 'Ouvir'}`}
      accessibilityHint={desktop ? undefined : 'Mantém premido para mais opções'}
    >
      <Cover t={t} size={56} radius={8} active={active} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{t.title}</Text>
        <Text style={s.rowSub} numberOfLines={1}>{meta}</Text>
      </View>
      {active || (desktop && hot) ? (
        <Pressable onPress={() => onUse(t)} style={(st) => [s.use, (st as { hovered?: boolean }).hovered && { backgroundColor: colors.brandLight }]} accessibilityRole="button" accessibilityLabel={`Usar ${t.title}`}>
          <Text style={s.useTxt}>Usar</Text>
        </Pressable>
      ) : null}
      {desktop && (hot || active) ? (
        <Pressable onPress={(e) => onMenu(t, anchorOf(e))} hitSlop={6} style={(st) => [s.iconBtn, (st as { hovered?: boolean }).hovered && { backgroundColor: C.line }]} accessibilityRole="button" accessibilityLabel="Mais opções da faixa" {...({ dataSet: { tip: 'Mais opções' } } as object)}>
          <Icon name="more" size={20} color={C.soft} />
        </Pressable>
      ) : null}
      {canSave(t) ? (
        <Pressable onPress={() => onSave(t)} hitSlop={8} style={(st) => [s.iconBtn, desktop && (st as { hovered?: boolean }).hovered && { backgroundColor: C.line }]} accessibilityRole="button" accessibilityState={{ selected: saved }} accessibilityLabel={saved ? 'Tirar das guardadas' : 'Guardar'}>
          <BookmarkIcon on={saved} size={22} color={saved ? C.text : C.soft} />
        </Pressable>
      ) : (
        <View style={s.iconBtn} />
      )}
    </Pressable>
  );
}

/** Os destaques de «Para ti»: um cartão largo por faixa, com o fundo das cores da capa; desliza entre eles, com pontos por baixo. */
function Highlights({ items, playing, onPlay, onUse }: { items: Track[]; playing: string | null; onPlay: (t: Track) => void; onUse: (t: Track) => void }) {
  const [w, setW] = useState(0);
  const [at, setAt] = useState(0);
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  if (!items.length) return null;
  const onLayout = (e: LayoutChangeEvent) => {
    const nw = Math.round(e.nativeEvent.layout.width);
    if (nw && nw !== w) setW(nw);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!w) return;
    const i = Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.x / w)));
    if (i !== at) setAt(i);
  };
  const go = (i: number) => {
    ref.current?.scrollTo({ x: i * w, animated: true });
    setAt(i);
  };
  return (
    <View style={{ marginTop: 14 }} onLayout={onLayout}>
      {w ? (
        <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEventThrottle={32} onScroll={onScroll} keyboardShouldPersistTaps="handled">
          {items.map((t) => (
            <View key={t.id} style={{ width: w, paddingHorizontal: 2 }}>
              <HighlightCard t={t} active={playing === t.id} onPlay={onPlay} onUse={onUse} />
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={{ height: HL_H }} />
      )}
      {items.length > 1 ? (
        <View style={s.dots}>
          {items.map((t, i) => (
            <Pressable key={t.id} onPress={() => go(i)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Destaque ${i + 1} de ${items.length}`} accessibilityState={{ selected: i === at }}>
              <View style={[s.dot, i === at && s.dotOn]} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const HL_H = 112;

function HighlightCard({ t, active, onPlay, onUse }: { t: Track; active: boolean; onPlay: (t: Track) => void; onUse: (t: Track) => void }) {
  const kicker = t.source === 'local' ? 'Artistas de Moçambique' : t.featured ? 'Em destaque' : 'Em alta';
  return (
    <Pressable onPress={() => onPlay(t)} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`${kicker}: ${t.title}, ${t.artist || 'Autor desconhecido'}. ${active ? 'A tocar' : 'Ouvir'}`}>
      <LinearGradient colors={highlightColors(t) as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hl}>
        <Cover t={t} size={80} radius={12} active={active} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.hlKicker} numberOfLines={1}>{kicker}</Text>
          <Text style={s.hlTitle} numberOfLines={2}>{t.title}</Text>
          <Text style={s.hlArtist} numberOfLines={1}>{t.artist || (t.artistUsername ? `@${t.artistUsername}` : 'Autor desconhecido')}</Text>
        </View>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <View style={s.hlPlay}>
            <Icon name={active ? 'pause' : 'play'} size={16} solid color="#fff" />
          </View>
          <Pressable onPress={() => onUse(t)} style={({ pressed }) => [s.hlUse, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Usar ${t.title}`}>
            <Text style={s.hlUseTxt}>Usar</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

/** O menu de uma faixa (manter premido, ou o «⋯» e o botão direito no computador): usar, ouvir, guardar e «Não gosto desta». */
function RowMenu({ track, anchor, playing, saved, onClose, onPlay, onUse, onSave, onDislike }: { track: Track; anchor: Rect | null; playing: boolean; saved: boolean; onClose: () => void; onPlay: (t: Track) => void; onUse: (t: Track) => void; onSave: (t: Track) => void; onDislike: (t: Track) => void }) {
  const run = (fn: (t: Track) => void) => () => {
    onClose();
    fn(track);
  };
  return (
    <Sheet title={track.title} onClose={onClose} dark variant="menu" anchor={anchor}>
      <View style={s.menu}>
        <MenuItem icon={<Icon name="check" size={20} color={C.text} />} label="Usar esta música" onPress={run(onUse)} />
        <MenuItem icon={<Icon name={playing ? 'pause' : 'play'} size={18} solid color={C.text} />} label={playing ? 'Parar' : 'Ouvir'} onPress={run(onPlay)} />
        {canSave(track) ? <MenuItem icon={<BookmarkIcon on={saved} size={20} color={C.text} />} label={saved ? 'Tirar das guardadas' : 'Guardar'} onPress={run(onSave)} /> : null}
        {track.kind !== 'clip' ? <MenuItem icon={<Icon name="eye-off" size={20} color={C.text} />} label="Não gosto desta" hint="Deixa de te aparecer" onPress={run(onDislike)} /> : null}
      </View>
    </Sheet>
  );
}

function MenuItem({ icon, label, hint, onPress }: { icon: ReactNode; label: string; hint?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={(st) => [s.mi, (st as { hovered?: boolean; pressed?: boolean }).hovered && s.miHover, st.pressed && s.miHover]} accessibilityRole="menuitem" accessibilityLabel={label}>
      <View style={s.miIcon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.miTxt}>{label}</Text>
        {hint ? <Text style={s.miHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, minHeight: 0 },
  deskTitle: { paddingLeft: 20, paddingRight: 64, marginTop: 4, marginBottom: 12, fontSize: 18, lineHeight: 28, fontWeight: '700', color: C.text },
  search: { marginHorizontal: 16, height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: C.raised, paddingHorizontal: 12 },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: C.text, padding: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  tabs: { marginTop: 12, flexGrow: 0, flexShrink: 0 },
  tabsIn: { gap: 6, paddingHorizontal: 16 },
  tab: { height: 34, borderRadius: 999, paddingHorizontal: 12, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#ffffff' },
  tabHover: { backgroundColor: C.line },
  tabTxt: { fontSize: 14, fontWeight: '600', color: '#ebebf0' },
  tabTxtOn: { color: C.bg, fontWeight: '700' },
  scroll: { flex: 1, minHeight: 0 },
  scrollIn: { paddingHorizontal: 16, paddingBottom: 16 },
  chips: { marginTop: 14, flexGrow: 0 },
  chip: { height: 30, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  chipOn: { backgroundColor: C.soft, borderColor: C.soft },
  chipHover: { backgroundColor: C.raised },
  chipTxt: { fontSize: 13, fontWeight: '600', color: C.soft },
  h: { marginTop: 18, marginBottom: 4, fontSize: 13, fontWeight: '700', color: C.sub },
  note: { marginTop: 16, fontSize: 12, lineHeight: 16, color: '#636366' },
  err: { marginTop: 10, fontSize: 14, color: '#ff6b81' },
  empty: { paddingVertical: 28, paddingHorizontal: 12, textAlign: 'center', fontSize: 15, lineHeight: 21, color: C.sub },
  center: { alignItems: 'center', justifyContent: 'center' },
  coverDim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 12 },
  rowOn: { backgroundColor: C.raised },
  rowHover: { backgroundColor: '#242426' },
  rowPressed: { backgroundColor: '#242426' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  rowSub: { marginTop: 2, fontSize: 13, color: C.sub },
  use: { height: 32, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  useTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hl: { height: HL_H, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' },
  hlKicker: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: 0.6 },
  hlTitle: { marginTop: 2, fontSize: 17, lineHeight: 22, fontWeight: '800', color: '#fff' },
  hlArtist: { marginTop: 2, fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  hlPlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  hlUse: { height: 30, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  hlUseTxt: { fontSize: 13, fontWeight: '800', color: C.bg },
  dots: { marginTop: 10, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#48484a' },
  dotOn: { width: 16, backgroundColor: '#fff' },
  undo: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: C.raised, paddingHorizontal: 12, paddingVertical: 10 },
  undoTxt: { flex: 1, minWidth: 0, fontSize: 14, color: C.soft },
  undoBtn: { fontSize: 14, fontWeight: '700', color: '#ff6b81' },
  menu: { paddingHorizontal: 8, paddingBottom: 8 },
  mi: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  miHover: { backgroundColor: C.raised },
  miIcon: { width: 24, alignItems: 'center' },
  miTxt: { fontSize: 16, fontWeight: '600', color: C.text },
  miHint: { fontSize: 13, color: C.sub },
  // O gravador do clipe próprio (ClipRecorder; hoje sem entrada no seletor).
  pressed: { transform: [{ scale: 0.96 }] },
  rec: { borderRadius: 16, backgroundColor: C.raised, padding: 12 },
  recTitle: { fontSize: 14, fontWeight: '600', color: C.text },
  bigBtn: { marginTop: 8, height: 44, borderRadius: 999, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  bigTxt: { fontSize: 16, fontWeight: '700', color: '#fff' },
  dot2: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' },
  recRow: { marginTop: 8, flexDirection: 'row', gap: 8 },
  listen: { height: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 6 },
  listenTxt: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  again: { height: 44, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  againTxt: { fontSize: 16, fontWeight: '600', color: C.soft },
  recUse: { height: 44, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
