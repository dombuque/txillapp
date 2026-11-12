import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { Icon } from '@/components/Icon';
import { Sheet, useSheetScroll } from '@/components/Sheet';
import { musicApi, type Track } from '@/lib/api.music';
import { LocalArtistsSection } from '@/components/LocalArtists';
import { suggestMusic } from '@/lib/musicSuggest';
import { uploadMedia } from '@/lib/api';
import { playTrack, stopTrack } from '@/lib/musicPlayer';
import { colors } from '@/lib/theme';

const mmss = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : '');
export const licenseLabel = (l: string) => (l === 'own' ? 'Original' : l === 'cc0' ? 'CC0' : l === 'pdm' ? 'Domínio público' : `CC ${l.toUpperCase()}`);

const CLIP_MAX_MS = 30_000;
const GENRES = ['chill', 'dance', 'afro', 'pop', 'rock', 'hip hop', 'jazz', 'piano', 'acoustic'];

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

/** Escolher uma faixa de música de licença aberta (Creative Commons): pesquisa, ouve-se um pedaço e usa-se. O crédito do autor segue com a faixa. */
export function MusicPicker({ onPick, onClose, hint, allowLocal = false }: { onPick: (t: Track) => void; onClose: () => void; /** O que a pessoa escreveu (texto e local): serve para sugerir o género. */ hint?: string; /** Mostra os «Artistas de Moçambique» (só mimos e tchekas, como diz a licença). */ allowLocal?: boolean }) {
  return (
    <Sheet title="Música e sons" onClose={onClose}>
      <PickerBody onPick={onPick} hint={hint} allowLocal={allowLocal} />
    </Sheet>
  );
}

function PickerBody({ onPick, hint, allowLocal }: { onPick: (t: Track) => void; hint?: string; allowLocal: boolean }) {
  const suggestion = useMemo(() => suggestMusic(hint), [hint]);
  const base: string = suggestion?.genre ?? GENRES[0];
  const me = useRef(Symbol('picker'));
  const sheetScroll = useSheetScroll();
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<Track[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  // Para ti: favoritas, as que usaste há pouco e as que a malta mais está a pôr. Guardadas em memória enquanto a app está aberta.
  const [tab, setTab] = useState<'forYou' | 'favorites' | 'search'>('forYou');
  const favs = useQuery({ queryKey: ['music-favorites'], queryFn: musicApi.favorites, staleTime: 60_000, retry: false });
  const sugg = useQuery({ queryKey: ['music-suggested'], queryFn: musicApi.suggested, staleTime: 5 * 60_000, retry: false });
  const qc = useQueryClient();
  const favIds = useMemo(() => new Set((favs.data ?? []).map((t) => t.id)), [favs.data]);
  const toggleFav = useMutation({
    mutationFn: (t: Track): Promise<{ favorite: boolean }> => (favIds.has(t.id) ? musicApi.removeFavorite(t.id) : musicApi.addFavorite(t)),
    onMutate: (t) => {
      // Muda logo no ecrã; o servidor confirma.
      qc.setQueryData<Track[]>(['music-favorites'], (old = []) => (old.some((x) => x.id === t.id) ? old.filter((x) => x.id !== t.id) : [t, ...old]));
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['music-favorites'] }),
  });

  // Procura meio segundo depois de parares de escrever. Sem pesquisa, mostra já uma lista (o primeiro género).
  useEffect(() => {
    const typed = term.trim();
    const q = typed.length >= 2 ? typed : base;
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      setErr('');
      try {
        const r = await musicApi.search(q);
        if (alive) setItems(r);
      } catch (e) {
        if (alive) {
          setErr((e as Error).message);
          setItems([]);
        }
      }
      if (alive) setBusy(false);
    }, typed.length >= 2 ? 500 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [term, base]);

  // Pára o som ao sair.
  useEffect(() => () => stopTrack(me.current), []);

  async function toggle(t: Track) {
    if (playing === t.id) {
      stopTrack(me.current);
      return;
    }
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

  const typed = term.trim();
  // Escrever na pesquisa passa logo para o separador Pesquisar.
  useEffect(() => { if (typed.length >= 2) setTab('search'); }, [typed]);

  /** Uma faixa na lista: ouvir, favorita (coração) e Usar. */
  const row = (t: Track) => {
    const fav = favIds.has(t.id);
    return (
      <View key={t.id} style={s.row}>
        <Pressable onPress={() => toggle(t)} style={({ pressed }) => [s.play, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={playing === t.id ? 'Parar' : 'Ouvir'}>
          <Icon name={playing === t.id ? 'pause' : 'play'} size={18} solid color="#fff" />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.rowTitle} numberOfLines={1}>{t.title}</Text>
          <Text style={s.rowSub} numberOfLines={1}>{t.artist || 'Autor desconhecido'}{t.durationMs ? ` · ${mmss(t.durationMs)}` : ''}</Text>
        </View>
        {t.kind !== 'clip' && t.source !== 'local' && (
          <Pressable onPress={() => toggleFav.mutate(t)} hitSlop={6} style={s.fav} accessibilityRole="button" accessibilityState={{ selected: fav }} accessibilityLabel={fav ? 'Tirar das favoritas' : 'Marcar como favorita'}>
            <Icon name="heart" size={20} solid={fav} color={fav ? colors.brand : colors.zinc500} />
          </Pressable>
        )}
        <Pressable onPress={() => pick(t)} style={({ pressed }) => [s.usar, pressed && s.pressed]} accessibilityRole="button"><Text style={s.usarTxt}>Usar</Text></Pressable>
      </View>
    );
  };
  const section = (title: string, list: Track[] | undefined, empty?: string) => (
    <View style={{ marginTop: 14 }}>
      <Text style={s.h}>{title}</Text>
      {list?.length ? list.map(row) : empty ? <Text style={s.emptySmall}>{empty}</Text> : null}
    </View>
  );
  const favorites = favs.data ?? [];
  const recent = (sugg.data?.recent ?? []).filter((t) => !favIds.has(t.id)).slice(0, 5);
  const trending = (sugg.data?.trending ?? []).slice(0, 10);

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
        <TextInput value={term} onChangeText={setTerm} onFocus={() => setTab('search')} placeholder="Procurar música ou sons" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar música ou sons" autoCorrect={false} style={s.input} />
      </View>
      <View style={s.tabs} accessibilityRole="tablist">
        {([['forYou', 'Para ti'], ['favorites', `Favoritas${favorites.length ? ` (${favorites.length})` : ''}`], ['search', 'Pesquisar']] as const).map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={[s.tab, tab === id && s.tabOn]}>
            <Text style={[s.tabTxt, tab === id && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'forYou' && (
        <>
          {suggestion ? <Text style={s.sugg}>Para o teu post ({suggestion.why}): experimenta {suggestion.genre}. <Text onPress={() => setTerm(suggestion.genre)} style={{ textDecorationLine: 'underline' }}>Ver</Text></Text> : null}
          {favorites.length ? section('As tuas favoritas', favorites.slice(0, 5)) : null}
          {recent.length ? section('Usaste há pouco', recent) : null}
          <LocalArtistsSection row={row} allow={allowLocal} />
          {sugg.isLoading ? <ActivityIndicator color={colors.zinc500} style={{ paddingVertical: 24 }} /> : section('A tocar no Txillapp', trending, 'Ainda ninguém pôs música esta semana. Sê o primeiro: pesquisa uma faixa.')}
          {!favorites.length && !recent.length && !trending.length && !sugg.isLoading ? (
            <Pressable onPress={() => setTab('search')} style={s.goSearch} accessibilityRole="button"><Text style={s.usarTxt}>Pesquisar música</Text></Pressable>
          ) : null}
        </>
      )}

      {tab === 'favorites' && (
        <View style={{ marginTop: 8 }}>
          {favs.isLoading ? <ActivityIndicator color={colors.zinc500} style={{ paddingVertical: 24 }} /> : favorites.length ? favorites.map(row) : <Text style={s.empty}>Ainda não tens favoritas. Toca no coração de uma faixa para a guardares aqui.</Text>}
        </View>
      )}

      {tab === 'search' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.chips} contentContainerStyle={{ gap: 6 }}>
            {GENRES.map((g) => {
              const on = typed === g || (!typed && g === base);
              return (
                <Pressable key={g} onPress={() => setTerm(g)} style={[s.chip, on && { backgroundColor: colors.brand }]} accessibilityRole="button">
                  <Text style={[s.chipTxt, on && { color: '#fff' }]}>{g}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {!!err && <Text style={s.err}>{err}</Text>}
          <View style={{ marginTop: 12 }}>
            {typed.length >= 2 ? <LocalArtistsSection q={typed} row={row} allow={allowLocal} /> : null}
            {busy && <ActivityIndicator color={colors.zinc500} style={{ paddingVertical: 24 }} />}
            {!busy && items?.length === 0 && !err && <Text style={s.empty}>Nada com esse nome</Text>}
            {!busy && items?.map(row)}
          </View>
        </>
      )}
      <Text style={s.note}>Só músicas e sons de licença aberta (Creative Commons), com o crédito de quem os fez. Para a música do momento, ainda não há licença.</Text>
    </ScrollView>
  );
}

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
