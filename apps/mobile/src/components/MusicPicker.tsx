import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { Icon } from '@/components/Icon';
import { Sheet, useSheetScroll } from '@/components/Sheet';
import { musicApi, type Track } from '@/lib/api.music';
import { creditLine, dropFromCache, licenseLabel, mmss, pickerTabs, styleChips, usesLabel, withoutDisliked, type PickerTab } from '@/lib/musicCatalog';
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
          <View style={s.dot} />
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
          <Pressable disabled={busy} onPress={use} style={({ pressed }) => [s.use, { flex: 1 }, busy && { opacity: 0.5 }, pressed && s.pressed]} accessibilityRole="button">
            <Text style={s.bigTxt}>{busy ? 'A enviar…' : 'Usar'}</Text>
          </Pressable>
        </View>
      )}
      {!!err && <Text style={s.err}>{err}</Text>}
    </View>
  );
}


/**
 * Escolher a música de um mimo, de um tcheka ou de uma nota, do catálogo curado do servidor: «Em alta no Txillapp», estilos,
 * «Artistas de Moçambique», «Sons» e favoritas, com pesquisa. Ouve-se um pedaço e usa-se; o crédito do autor segue com a faixa.
 */
export function MusicPicker({ onPick, onClose, hint }: { onPick: (t: Track) => void; onClose: () => void; /** O que a pessoa escreveu (texto e local): serve para sugerir o estilo. */ hint?: string }) {
  return (
    <Sheet title="Música e sons" onClose={onClose}>
      <PickerBody onPick={onPick} hint={hint} />
    </Sheet>
  );
}

function PickerBody({ onPick, hint }: { onPick: (t: Track) => void; hint?: string }) {
  const suggestion = useMemo(() => suggestMusic(hint), [hint]);
  const me = useRef(Symbol('picker'));
  const sheetScroll = useSheetScroll();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [tab, setTab] = useState<PickerTab>('trending');
  // As que marquei com «Não gosto desta» enquanto o seletor está aberto (o servidor já não as manda da próxima vez).
  const [disliked, setDisliked] = useState<ReadonlySet<string>>(() => new Set());
  const [undo, setUndo] = useState<Track | null>(null);

  const home = useQuery({ queryKey: ['music-home'], queryFn: musicApi.home, staleTime: 5 * 60_000, retry: false });
  const favs = useQuery({ queryKey: ['music-favorites'], queryFn: musicApi.favorites, staleTime: 60_000, retry: false });
  const styleId = tab.startsWith('style:') ? tab.slice(6) : null;
  const styleList = useQuery({ queryKey: ['music-style', styleId], queryFn: () => musicApi.style(styleId!), enabled: !!styleId, staleTime: 10 * 60_000, retry: false });
  const localList = useQuery({ queryKey: ['music-local'], queryFn: () => musicApi.local(), enabled: tab === 'local', staleTime: 10 * 60_000, retry: false });
  const soundList = useQuery({ queryKey: ['music-sounds'], queryFn: musicApi.sounds, enabled: tab === 'sounds', staleTime: 10 * 60_000, retry: false });
  const found = useQuery({ queryKey: ['music-search', query], queryFn: () => musicApi.search(query), enabled: query.length >= 2, staleTime: 5 * 60_000, retry: false });

  const favIds = useMemo(() => new Set((favs.data ?? []).map((t) => t.id)), [favs.data]);
  const toggleFav = useMutation({
    mutationFn: (t: Track): Promise<{ favorite: boolean }> => (favIds.has(t.id) ? musicApi.removeFavorite(t.id) : musicApi.addFavorite(t)),
    onMutate: (t) => {
      // Muda logo no ecrã; o servidor confirma.
      qc.setQueryData<Track[]>(['music-favorites'], (old = []) => (old.some((x) => x.id === t.id) ? old.filter((x) => x.id !== t.id) : [t, ...old]));
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['music-favorites'] }),
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
    const ok = await playTrack(me.current, t.url, { loop: false, onStop: () => setPlaying(null) });
    if (!ok) {
      setPlaying(null);
      setErr('Não consegui tocar');
    }
  }
  function pick(t: Track) {
    stopTrack(me.current);
    onPick(t);
  }

  /** Uma faixa na lista: ouvir, favorita (coração), «Não gosto desta» e Usar. Em «Em alta», o destaque e as vezes que foi usada. */
  const row = (t: Track, opts: { trending?: boolean } = {}) => {
    const fav = favIds.has(t.id);
    const uses = opts.trending ? usesLabel(t.uses) : '';
    return (
      <View key={t.id} style={s.row}>
        <Pressable onPress={() => toggle(t)} style={({ pressed }) => [s.play, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={playing === t.id ? 'Parar' : 'Ouvir'}>
          <Icon name={playing === t.id ? 'pause' : 'play'} size={18} solid color="#fff" />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={x.titleRow}>
            {opts.trending && t.featured ? <Text style={x.badge}>Destaque</Text> : null}
            <Text style={[s.rowTitle, { flexShrink: 1 }]} numberOfLines={1}>{t.title}</Text>
          </View>
          <Text style={s.rowSub} numberOfLines={1}>{creditLine(t, mmss)}</Text>
          {uses ? <Text style={x.uses} numberOfLines={1}>{uses}</Text> : null}
        </View>
        {t.kind !== 'clip' && (
          <Pressable onPress={() => toggleFav.mutate(t)} hitSlop={6} style={s.fav} accessibilityRole="button" accessibilityState={{ selected: fav }} accessibilityLabel={fav ? 'Tirar das favoritas' : 'Marcar como favorita'}>
            <Icon name="heart" size={20} solid={fav} color={fav ? colors.brand : colors.zinc500} />
          </Pressable>
        )}
        {t.kind !== 'clip' && (
          <Pressable onPress={() => dislike.mutate(t)} hitSlop={6} style={x.nope} accessibilityRole="button" accessibilityLabel="Não gosto desta">
            <Icon name="x" size={18} color={colors.zinc500} />
          </Pressable>
        )}
        <Pressable onPress={() => pick(t)} style={({ pressed }) => [s.usar, pressed && s.pressed]} accessibilityRole="button"><Text style={s.usarTxt}>Usar</Text></Pressable>
      </View>
    );
  };
  const list = (q: { isLoading: boolean; data?: Track[]; error?: unknown }, empty: string, opts: { trending?: boolean } = {}) => {
    if (q.isLoading) return <ActivityIndicator color={colors.zinc500} style={{ paddingVertical: 24 }} />;
    if (q.error) return <Text style={s.err}>{(q.error as Error).message || 'Não consegui abrir a música agora'}</Text>;
    const items = withoutDisliked(q.data, disliked);
    return items.length ? items.map((t) => row(t, opts)) : <Text style={s.empty}>{empty}</Text>;
  };

  const tabs = pickerTabs(home.data);
  const chips = styleChips(home.data?.styles, suggestion?.genre);
  const suggestedStyle = suggestion ? chips.find((c) => c.id === suggestion.genre) : undefined;
  const favorites = withoutDisliked(favs.data, disliked);
  const recent = withoutDisliked(home.data?.recent, disliked).filter((t) => !favIds.has(t.id)).slice(0, 5);
  // Se a secção que estava aberta deixou de existir (ex.: sem artistas locais), volta a «Em alta».
  useEffect(() => {
    if ((tab === 'local' || tab === 'sounds') && home.data && !tabs.some((t) => t.id === tab)) setTab('trending');
  }, [tab, home.data, tabs]);

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.scrollIn}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      onScroll={(e) => {
        if (sheetScroll) sheetScroll.top.current = e.nativeEvent.contentOffset.y <= 0;
      }}
    >
      <View style={s.search}>
        <Icon name="search" size={18} color={colors.zinc500} />
        <TextInput value={term} onChangeText={setTerm} placeholder="Procurar música, artista ou estilo" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar música, artista ou estilo" autoCorrect={false} style={s.input} />
        {term ? (
          <Pressable onPress={() => setTerm('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa">
            <Icon name="x" size={16} color={colors.zinc500} />
          </Pressable>
        ) : null}
      </View>

      {undo ? (
        <View style={x.undo} accessibilityLiveRegion="polite">
          <Text style={x.undoTxt} numberOfLines={1}>Tirada: {undo.title}.</Text>
          <Pressable onPress={() => undislike.mutate(undo)} hitSlop={6} accessibilityRole="button"><Text style={x.undoBtn}>Desfazer</Text></Pressable>
        </View>
      ) : null}
      {!!err && <Text style={s.err}>{err}</Text>}

      {searching ? (
        <View style={{ marginTop: 12 }}>{list(found, 'Nada com esse nome')}</View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.chips} contentContainerStyle={{ gap: 6 }} accessibilityRole="tablist">
            {tabs.map(({ id, label }) => (
              <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={[s.tab, tab === id && s.tabOn]}>
                <Text style={[s.tabTxt, tab === id && { color: '#fff' }]}>{id === 'favorites' && favorites.length ? `${label} (${favorites.length})` : label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {chips.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.chips} contentContainerStyle={{ gap: 6 }}>
              {chips.map((c) => {
                const on = tab === `style:${c.id}`;
                return (
                  <Pressable key={c.id} onPress={() => setTab(on ? 'trending' : `style:${c.id}`)} style={[s.chip, on && { backgroundColor: colors.brand }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Text style={[s.chipTxt, on && { color: '#fff' }]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          {suggestedStyle && tab === 'trending' ? (
            <Text style={s.sugg}>
              Para o teu post ({suggestion!.why}): experimenta {suggestedStyle.label}.{' '}
              <Text onPress={() => setTab(`style:${suggestedStyle.id}`)} style={{ textDecorationLine: 'underline' }}>Ver</Text>
            </Text>
          ) : null}

          {tab === 'trending' && (
            <>
              {recent.length ? (
                <View style={{ marginTop: 14 }}>
                  <Text style={s.h}>Usaste há pouco</Text>
                  {recent.map((t) => row(t))}
                </View>
              ) : null}
              <View style={{ marginTop: 14 }}>
                <Text style={s.h}>Em alta no Txillapp</Text>
                {list({ isLoading: home.isLoading, data: home.data?.trending, error: home.error }, 'Ainda não há músicas em alta. Escolhe um estilo ou pesquisa.', { trending: true })}
              </View>
            </>
          )}
          {styleId ? <View style={{ marginTop: 12 }}>{list(styleList, 'Ainda não há músicas deste estilo.')}</View> : null}
          {tab === 'local' && (
            <View style={{ marginTop: 14 }}>
              <Text style={s.h}>Artistas de Moçambique</Text>
              {list(localList, 'Ainda não há músicas de artistas de Moçambique.')}
            </View>
          )}
          {tab === 'sounds' && <View style={{ marginTop: 12 }}>{list(soundList, 'Ainda não há sons.')}</View>}
          {tab === 'favorites' && (
            <View style={{ marginTop: 8 }}>
              {favs.isLoading ? <ActivityIndicator color={colors.zinc500} style={{ paddingVertical: 24 }} /> : favorites.length ? favorites.map((t) => row(t)) : <Text style={s.empty}>Ainda não tens favoritas. Toca no coração de uma faixa para a guardares aqui.</Text>}
            </View>
          )}
        </>
      )}
      <Text style={s.note}>Só músicas que se podem pôr em vídeos partilhados: licença aberta (CC0, domínio público ou CC BY, com o crédito de quem as fez) e artistas de Moçambique que deram autorização ao Txillapp. Toca no X («Não gosto desta») para deixares de ver uma faixa.</Text>
    </ScrollView>
  );
}

const x = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  badge: { fontSize: 11, fontWeight: '800', color: '#fff', backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  uses: { fontSize: 12, color: colors.zinc500 },
  nope: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  undo: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 12, paddingVertical: 8 },
  undoTxt: { flex: 1, minWidth: 0, fontSize: 14, color: colors.zinc700 },
  undoBtn: { fontSize: 14, fontWeight: '700', color: colors.brand },
});


const s = StyleSheet.create({
  sugg: { marginTop: 8, fontSize: 13, fontWeight: '600', color: colors.brand },
  scroll: { flexGrow: 0, maxHeight: 520 },
  scrollIn: { paddingHorizontal: 24, paddingBottom: 8 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, padding: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  chips: { marginTop: 8, flexGrow: 0 },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  chipTxt: { fontSize: 13, fontWeight: '600', color: colors.zinc700 },
  note: { marginTop: 12, fontSize: 12, lineHeight: 16, color: colors.zinc500 },
  err: { marginTop: 8, fontSize: 14, color: colors.red600 },
  empty: { paddingVertical: 24, textAlign: 'center', fontSize: 16, color: colors.zinc500 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  rowSub: { fontSize: 14, color: colors.zinc500 },
  usar: { height: 36, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  usarTxt: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  pressed: { transform: [{ scale: 0.96 }] },
  tabs: { marginTop: 10, flexDirection: 'row', gap: 6 },
  tab: { height: 34, borderRadius: 999, paddingHorizontal: 14, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.zinc900 },
  tabTxt: { fontSize: 13, fontWeight: '700', color: colors.zinc700 },
  h: { fontSize: 13, fontWeight: '700', color: colors.zinc500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  fav: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  emptySmall: { paddingVertical: 10, fontSize: 14, color: colors.zinc500 },
  goSearch: { marginTop: 12, height: 44, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  rec: { borderRadius: 16, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc100, padding: 12 },
  recTitle: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  bigBtn: { marginTop: 8, height: 44, borderRadius: 999, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  bigTxt: { fontSize: 16, fontWeight: '700', color: '#fff' },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' },
  recRow: { marginTop: 8, flexDirection: 'row', gap: 8 },
  listen: { height: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.zinc200, flexDirection: 'row', alignItems: 'center', gap: 6 },
  listenTxt: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  again: { height: 44, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  againTxt: { fontSize: 16, fontWeight: '600', color: colors.zinc600 },
  use: { height: 44, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
