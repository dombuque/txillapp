import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { composeApi } from '@/lib/api.compose';
import { startLive } from '@/lib/liveShare';
import { createDebounce, formatAddress, placeKindIcon, round6, searchQuery } from '@/lib/placeField';
import {
  DEFAULT_CENTER, LIVE_DURATIONS, accuracyText, buildLocationMessage, currentA11y, distanceM, distanceText, liveConfirmText, liveLabel, mainButton,
  nearbyRows, permissionNotice, placeConfirmA11y, searchRows, validPoint, weakAccuracy,
  type Fix, type LatLng, type LiveMinutes, type LocationMessage, type SheetState, type SpotChoice, type SpotRow,
} from '@/lib/sendLocation';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { PlaceMiniMap } from './nearby/PlaceMiniMap';
import { PlacePickMap } from './nearby/PlacePickMap';

const web = Platform.OS === 'web';
/** Só se volta a pedir "Sítios perto" quando o ponto de partida anda mais do que isto. */
const NEARBY_AGAIN_M = 150;

type Step = { type: 'main' } | { type: 'live' } | { type: 'place'; place: SpotChoice; resolving: boolean };

/**
 * "Enviar localização", como no WhatsApp. Abre ao tocar em "Localização" no "+" do chat (conversas e TxillGroups) e NUNCA
 * envia sozinha: cada envio é um toque explícito.
 *  - Em cima, o mapa com a minha posição (ponto azul, círculo da precisão e "Precisão de 12 m"), a atualizar enquanto está
 *    aberta. Arrastar o mapa põe um pino ao centro e o botão passa a "Enviar esta localização" (com a morada do pino).
 *  - "Partilhar localização em direto" (só nas conversas): escolher 15 min / 1 h / 8 h e confirmar.
 *  - "Enviar a tua localização atual" com a precisão.
 *  - "Sítios perto" (com a distância) e "Procurar um sítio": escolher um pede confirmação (mapa, nome e morada) e "Enviar".
 *  - Sem permissão: explica antes de pedir; recusada, deixa procurar e enviar um sítio; bloqueada, "Abrir definições"
 *    (no site, explica o cadeado do browser).
 * A lógica (textos, distâncias, botão, mensagem) está em lib/sendLocation.ts.
 */
export function SendLocationSheet({ onClose, onSend, allowLive, who }: {
  onClose: () => void;
  /** Envia a mensagem (conversa ou grupo); devolve o id da mensagem criada. Se falhar, a folha mostra o erro e fica aberta. */
  onSend: (msg: LocationMessage) => Promise<{ id: string } | unknown>;
  /** Partilha em direto (as conversas; os grupos não a têm). */
  allowLive: boolean;
  /** O primeiro nome de quem recebe, para a confirmação da partilha em direto. */
  who?: string;
}) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const wide = win.width >= 768;

  const [permission, setPermission] = useState<SheetState['permission']>('checking');
  const [fix, setFix] = useState<Fix | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [pinAt, setPinAt] = useState<LatLng | null>(null);
  const [dragged, setDragged] = useState(false);
  const draggedRef = useRef(false);
  draggedRef.current = dragged;
  const [pinAddress, setPinAddress] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ type: 'main' });
  const [minutes, setMinutes] = useState<LiveMinutes>(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fixErr, setFixErr] = useState('');

  const [nearby, setNearby] = useState<{ rows: SpotRow[]; area: string | null } | null>(null);
  const [nearbyState, setNearbyState] = useState<'idle' | 'loading' | 'error'>('idle');
  const nearbyAt = useRef<LatLng | null>(null);

  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SpotRow[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [searchFocus, setSearchFocus] = useState(false);

  /* ───────── permissão e posição ───────── */

  const check = useCallback(async () => {
    try {
      const p = await Location.getForegroundPermissionsAsync();
      if (p.granted) return setPermission('granted');
      // No browser um "não" fica gravado no site: já não se pode voltar a perguntar daqui.
      if (p.status === 'denied' && (web || p.canAskAgain === false)) return setPermission('blocked');
      setPermission(p.status === 'denied' ? 'denied' : 'ask');
    } catch {
      setPermission('ask');
    }
  }, []);
  useEffect(() => { void check(); }, [check]);

  async function ask() {
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (p.granted) return setPermission('granted');
      setPermission(p.canAskAgain === false || web ? 'blocked' : 'denied');
    } catch {
      setPermission(web ? 'blocked' : 'denied');
    }
  }

  // Com permissão: segue a posição enquanto a folha está aberta (o ponto azul e a precisão atualizam-se).
  useEffect(() => {
    if (permission !== 'granted') return;
    let alive = true;
    let sub: Location.LocationSubscription | null = null;
    const onFix = (p: Location.LocationObject) => {
      if (!alive) return;
      const f: Fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
      if (!validPoint(f)) return;
      setFixErr('');
      setFix((old) => {
        // Enquanto não arrasto, o mapa acompanha-me (sem tremer por diferenças de 1 ou 2 metros).
        if (!draggedRef.current && (!old || distanceM(old, f) > 3)) setMapCenter({ lat: f.lat, lng: f.lng });
        return f;
      });
    };
    (async () => {
      if (!web) {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 }).catch(() => null);
        if (last) onFix(last);
      }
      const s = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2_000, distanceInterval: 1 }, onFix);
      if (alive) sub = s;
      else s.remove();
    })().catch(() => { if (alive) setFixErr('Não consegui saber onde estás. Vê se a localização do aparelho está ligada.'); });
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [permission]);

  /* ───────── mapa ───────── */

  const onMove = useCallback((c: LatLng) => {
    if (draggedRef.current) setPinAt(c);
  }, []);
  const onDrag = useCallback(() => {
    if (!draggedRef.current) {
      draggedRef.current = true;
      setDragged(true);
    }
  }, []);
  function backToMe() {
    if (!fix) return;
    draggedRef.current = false;
    setDragged(false);
    setPinAt(null);
    setPinAddress(null);
    setMapCenter({ lat: fix.lat, lng: fix.lng });
  }

  // A morada do pino (para a linha de "Enviar esta localização" e para ir com a mensagem).
  useEffect(() => {
    if (!dragged || !pinAt) return;
    setPinAddress(null);
    let alive = true;
    const t = setTimeout(() => {
      composeApi.reversePlace(round6(pinAt.lat), round6(pinAt.lng))
        .then((rev) => { if (alive) setPinAddress(formatAddress(rev) || null); })
        .catch(() => undefined);
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [dragged, pinAt]);

  /* ───────── sítios perto e pesquisa ───────── */

  // O ponto de partida: o pino (se arrastei), senão a minha posição.
  const base: LatLng | null = dragged && pinAt ? pinAt : fix;
  useEffect(() => {
    if (!base) return;
    if (nearbyAt.current && distanceM(nearbyAt.current, base) < NEARBY_AGAIN_M && nearbyState !== 'error') return;
    let alive = true;
    const t = setTimeout(() => {
      nearbyAt.current = base;
      setNearbyState('loading');
      composeApi.nearbyPlaces(round6(base.lat), round6(base.lng))
        .then((r) => { if (alive) { setNearby({ rows: nearbyRows(r.places, base, r.area ?? r.city), area: r.area ?? r.city }); setNearbyState('idle'); } })
        .catch(() => { if (alive) { nearbyAt.current = null; setNearbyState('error'); } });
    }, 500);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.lat, base?.lng]);
  // A distância conta-se a partir de onde estou agora (a lista não volta a ser pedida por cada passo).
  const nearbyShown = useMemo(() => (nearby ? nearby.rows.map((r) => {
    const d = base ? distanceM(base, r) : r.distanceM;
    return { ...r, distanceM: d, sub: distanceText(d) };
  }).sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity)) : []), [nearby, base]);

  const debounce = useMemo(() => createDebounce<string>((q) => setQuery(q)), []);
  useEffect(() => () => debounce.cancel(), [debounce]);
  useEffect(() => {
    if (!query) { setHits([]); setSearchState('idle'); return; }
    let alive = true;
    setSearchState('loading');
    const at = fix ?? pinAt ?? undefined;
    composeApi.searchPlaces(query, at ? { lat: Math.round(at.lat * 1e3) / 1e3, lng: Math.round(at.lng * 1e3) / 1e3 } : undefined)
      .then((r) => { if (alive) { setHits(searchRows(r, fix ?? pinAt)); setSearchState('idle'); } })
      .catch(() => { if (alive) setSearchState('error'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  /* ───────── enviar ───────── */

  const button = mainButton({ permission, fix, dragged, center: pinAt });

  async function send(msg: LocationMessage | null, live?: { minutes: number; from: LatLng }) {
    if (!msg || busy) return;
    setErr('');
    setBusy(true);
    try {
      const r = await onSend(msg);
      const id = (r as { id?: string } | undefined)?.id;
      if (live && id) startLive(id, Date.now() + live.minutes * 60_000, live.from);
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui enviar a localização.');
    } finally {
      setBusy(false);
    }
  }
  function sendMain() {
    if (button.action === 'pin' && pinAt) void send(buildLocationMessage({ type: 'pin', at: pinAt, address: pinAddress }));
    else if (button.action === 'current' && fix) void send(buildLocationMessage({ type: 'current', fix }));
  }
  function sendLive() {
    if (!fix) return;
    void send(buildLocationMessage({ type: 'live', fix, minutes }, { allowLive }), { minutes, from: fix });
  }
  function choosePlace(r: SpotRow) {
    Keyboard.dismiss();
    setErr('');
    const place: SpotChoice = { name: r.name, address: r.address, lat: r.lat, lng: r.lng, kind: r.kind };
    // Os "Sítios perto" só trazem o bairro: a morada certa vem do ponto do sítio (se não vier, fica o que havia).
    const needs = r.key.startsWith('n:');
    setStep({ type: 'place', place, resolving: needs });
    if (!needs) return;
    composeApi.reversePlace(round6(r.lat), round6(r.lng))
      .then((rev) => {
        const a = formatAddress(rev);
        setStep((s) => (s.type === 'place' && s.place.lat === r.lat && s.place.lng === r.lng ? { type: 'place', place: { ...s.place, address: a || s.place.address }, resolving: false } : s));
      })
      .catch(() => setStep((s) => (s.type === 'place' ? { ...s, resolving: false } : s)));
  }

  const back = () => {
    if (busy) return;
    if (step.type !== 'main') setStep({ type: 'main' });
    else onClose();
  };

  /* ───────── desenho ───────── */

  const notice = permissionNotice(permission, web);
  const searching = searchFocus || !!text.trim();
  const mapH = searching ? 120 : Math.round(Math.min(380, Math.max(200, win.height * 0.36)));
  const canLive = allowLive && permission === 'granted' && !!fix;
  const me = fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null;

  const listTitle = query ? 'Resultados' : 'Sítios perto';
  const rows = query ? hits : nearbyShown;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={back} statusBarTranslucent>
      <View style={[st.backdrop, wide && { backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }]}>
        <View
          style={[st.card, wide ? { width: 560, maxHeight: Math.min(860, win.height - 48), height: '100%', borderRadius: 24 } : { flex: 1, paddingTop: insets.top }]}
          accessibilityViewIsModal
        >
          {/* Cabeçalho */}
          <View style={st.head}>
            <Pressable onPress={back} style={st.headBtn} accessibilityRole="button" accessibilityLabel={step.type === 'main' ? 'Fechar' : 'Voltar'}>
              <Icon name={step.type === 'main' ? 'x' : 'back'} size={24} color={colors.zinc900} />
            </Pressable>
            <Text style={st.title} accessibilityRole="header" numberOfLines={1}>Enviar localização</Text>
            <View style={st.headBtn} />
          </View>

          {/* Mapa */}
          <View style={{ height: mapH }}>
            <PlacePickMap center={mapCenter} onMove={onMove} onDrag={onDrag} me={me} pin={dragged} zone={false} zoom={16} zoomControl={web} style={{ flex: 1 }} />
            {fix && !dragged ? (
              <View style={st.chip} pointerEvents="none">
                <View style={st.chipDot} />
                <Text style={st.chipText}>{accuracyText(fix.accuracy)}</Text>
              </View>
            ) : null}
            {dragged && fix ? (
              <Pressable onPress={backToMe} style={st.recenter} accessibilityRole="button" accessibilityLabel="Voltar à minha posição">
                <Icon name="locate" size={22} color={colors.sky} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}>
            {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}

            {/* Permissão */}
            {notice ? (
              <View style={st.notice}>
                <Icon name={notice.action === 'ask' ? 'map-pin' : 'lock'} size={22} color={colors.zinc700} />
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text style={st.noticeTitle}>{notice.title}</Text>
                  <Text style={st.noticeText}>{notice.text}</Text>
                  {notice.action ? (
                    <Pressable
                      onPress={() => (notice.action === 'ask' ? void ask() : void Linking.openSettings().catch(() => undefined))}
                      style={({ pressed }) => [st.noticeBtn, pressed && { opacity: 0.8 }]}
                      accessibilityRole="button"
                    >
                      <Text style={st.noticeBtnText}>{notice.actionLabel}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
            {fixErr && !fix ? <Text style={st.hint} accessibilityRole="alert">{fixErr}</Text> : null}

            {/* Opções */}
            {!searching && (
              <>
                {allowLive && !dragged ? (
                  <Row
                    icon="locate"
                    tint={canLive ? '#059669' : colors.zinc300}
                    title="Partilhar localização em direto"
                    sub={canLive ? 'Escolhe durante quanto tempo' : 'Precisa de acesso à tua localização'}
                    disabled={!canLive || busy}
                    onPress={() => setStep({ type: 'live' })}
                  />
                ) : null}
                <Row
                  icon="map-pin"
                  tint={button.action ? colors.brand : colors.zinc300}
                  title={button.label}
                  sub={button.action === 'pin' ? (pinAddress ?? (pinAt ? `${pinAt.lat.toFixed(5)}, ${pinAt.lng.toFixed(5)}` : button.sub)) : button.sub}
                  a11y={button.action === 'current' ? currentA11y(fix) : undefined}
                  disabled={!button.action || busy}
                  busy={busy && step.type === 'main'}
                  onPress={sendMain}
                />
                {button.action === 'current' && fix && weakAccuracy(fix.accuracy) ? (
                  <Text style={st.hint}>A posição ainda não é precisa. Espera uns segundos, arrasta o mapa até ao sítio certo ou escolhe um sítio da lista.</Text>
                ) : null}
              </>
            )}

            {/* Pesquisa */}
            <View style={st.search}>
              <Icon name="search" size={18} color={colors.zinc500} />
              <TextInput
                value={text}
                onChangeText={(v) => { setText(v); debounce.push(searchQuery(v)); }}
                onFocus={() => setSearchFocus(true)}
                onBlur={() => setSearchFocus(false)}
                placeholder="Procurar um sítio"
                placeholderTextColor={colors.zinc500}
                returnKeyType="search"
                onSubmitEditing={() => setQuery(searchQuery(text))}
                style={st.searchInput}
                accessibilityRole="search"
                accessibilityLabel="Procurar um sítio"
                maxLength={80}
              />
              {text ? (
                <Pressable onPress={() => { setText(''); setQuery(''); debounce.cancel(); }} style={st.clear} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa">
                  <Icon name="x" size={16} color={colors.zinc600} />
                </Pressable>
              ) : null}
            </View>

            {/* Sítios perto / resultados */}
            <Text style={st.section} accessibilityRole="header">{listTitle}</Text>
            {(query ? searchState : nearbyState) === 'loading' && rows.length === 0 ? (
              <View style={st.loading}><ActivityIndicator color={colors.zinc500} /></View>
            ) : null}
            {rows.map((r) => (
              <Row key={r.key} icon={placeKindIcon(r.kind) as IconName} tint={colors.zinc100} ink={colors.zinc800} title={r.name} sub={r.sub} disabled={busy} onPress={() => choosePlace(r)} a11y={`${r.name}${r.sub ? `, ${r.sub}` : ''}. Toca para confirmar e enviar`} />
            ))}
            {query && searchState === 'idle' && hits.length === 0 ? <Text style={st.hint}>Não encontrei sítios com esse nome. Tenta outra palavra.</Text> : null}
            {query && searchState === 'error' ? <Text style={st.hint}>Não consegui procurar agora. Verifica a ligação e tenta outra vez.</Text> : null}
            {!query && nearbyState === 'error' ? <Text style={st.hint}>Não consegui carregar os sítios perto. Podes procurar um sítio.</Text> : null}
            {!query && !base && nearbyState !== 'loading' ? (
              <Text style={st.hint}>{permission === 'granted' ? 'A procurar a tua posição…' : 'Procura um sítio pelo nome, ou arrasta o mapa até ao sítio.'}</Text>
            ) : null}
            {!query && base && nearby && nearby.rows.length === 0 && nearbyState === 'idle' ? <Text style={st.hint}>Não há sítios conhecidos aqui perto. Podes procurar um.</Text> : null}
          </ScrollView>

          {/* Partilha em direto: escolher a duração e confirmar */}
          {step.type === 'live' ? (
            <Overlay onClose={back} bottom={insets.bottom}>
              <Text style={st.ovTitle} accessibilityRole="header">Partilhar localização em direto</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="Durante quanto tempo" style={{ gap: 6 }}>
                {LIVE_DURATIONS.map((d) => {
                  const on = minutes === d.minutes;
                  return (
                    <Pressable key={d.minutes} onPress={() => setMinutes(d.minutes)} style={[st.radio, on && st.radioOn]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={d.label}>
                      <View style={[st.radioDot, on && { borderColor: colors.brand }]}>{on ? <View style={st.radioIn} /> : null}</View>
                      <Text style={[st.radioText, on && { color: colors.zinc900 }]}>{d.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={st.ovText}>{liveConfirmText(minutes, who)}</Text>
              {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
              <View style={st.ovBtns}>
                <Pressable onPress={back} disabled={busy} style={[st.btn, st.btnGhost]} accessibilityRole="button"><Text style={st.btnGhostText}>Cancelar</Text></Pressable>
                <Pressable onPress={sendLive} disabled={busy || !fix} style={[st.btn, st.btnMain, (busy || !fix) && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`Partilhar durante ${liveLabel(minutes)}`}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.btnMainText}>Partilhar</Text>}
                </Pressable>
              </View>
            </Overlay>
          ) : null}

          {/* Um sítio: confirmar (mapa, nome e morada) e "Enviar" */}
          {step.type === 'place' ? (
            <Overlay onClose={back} bottom={insets.bottom}>
              <PlaceMiniMap lat={step.place.lat} lng={step.place.lng} height={180} label={`Mapa com ${step.place.name} marcado`} />
              <View style={{ gap: 2 }}>
                <Text style={st.ovTitle} accessibilityRole="header" numberOfLines={2}>{step.place.name}</Text>
                {step.resolving && !step.place.address ? (
                  <Text style={st.ovText}>A procurar a morada…</Text>
                ) : step.place.address ? (
                  <Text style={st.ovText} numberOfLines={3}>{step.place.address}</Text>
                ) : null}
              </View>
              {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
              <View style={st.ovBtns}>
                <Pressable onPress={back} disabled={busy} style={[st.btn, st.btnGhost]} accessibilityRole="button"><Text style={st.btnGhostText}>Cancelar</Text></Pressable>
                <Pressable
                  onPress={() => void send(buildLocationMessage({ type: 'place', place: step.place }))}
                  disabled={busy}
                  style={[st.btn, st.btnMain, busy && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={placeConfirmA11y(step.place)}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.btnMainText}>Enviar</Text>}
                </Pressable>
              </View>
            </Overlay>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** Uma linha da folha (ícone redondo, título e linha de baixo). Pelo menos 56 de altura. */
function Row({ icon, tint, ink = '#fff', title, sub, onPress, disabled, busy, a11y }: { icon: IconName; tint: string; ink?: string; title: string; sub?: string | null; onPress: () => void; disabled?: boolean; busy?: boolean; a11y?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [st.row, (pressed || hovered) && !disabled && { backgroundColor: colors.zinc100 }]}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? (sub ? `${title}, ${sub}` : title)}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
    >
      <View style={[st.rowIcon, { backgroundColor: tint }]}>
        {busy ? <ActivityIndicator color={ink} /> : <Icon name={icon} size={20} color={ink} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.rowTitle, disabled && !busy && { color: colors.zinc500 }]} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={st.rowSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

/** O passo de confirmar, por cima da folha (o fundo escurece; tocar nele volta atrás). */
function Overlay({ children, onClose, bottom }: { children: React.ReactNode; onClose: () => void; bottom: number }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Voltar" />
      <View style={[st.ov, { paddingBottom: Math.max(bottom, 12) + 8 }]} accessibilityViewIsModal>
        {children}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#fff' },
  card: { backgroundColor: '#fff', overflow: 'hidden', width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, minHeight: 52 },
  headBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.zinc900 },
  chip: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 10, paddingVertical: 5, boxShadow: '0 1px 4px rgba(0,0,0,0.18)' } as object,
  chipDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sky },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.zinc800 },
  recenter: { position: 'absolute', right: 12, bottom: 12, width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 6px rgba(0,0,0,0.22)' } as object,
  err: { marginHorizontal: 16, marginTop: 10, fontSize: 14, color: colors.red600, textAlign: 'center' },
  hint: { marginHorizontal: 16, marginVertical: 8, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  notice: { flexDirection: 'row', gap: 12, margin: 12, marginBottom: 4, borderRadius: 16, backgroundColor: colors.zinc100, padding: 14 },
  noticeTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  noticeText: { fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  noticeBtn: { alignSelf: 'flex-start', marginTop: 6, minHeight: 44, borderRadius: 22, backgroundColor: colors.zinc900, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  noticeBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: 16, paddingVertical: 8 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.zinc900 },
  rowSub: { fontSize: 13, lineHeight: 17, color: colors.zinc500, marginTop: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 10, minHeight: 44, borderRadius: 22, backgroundColor: colors.zinc100, paddingLeft: 14, paddingRight: 4 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  section: { marginTop: 14, marginBottom: 2, marginHorizontal: 16, fontSize: 13, fontWeight: '700', color: colors.zinc500, textTransform: 'uppercase', letterSpacing: 0.4 },
  loading: { paddingVertical: 16, alignItems: 'center' },
  ov: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16 },
  ovTitle: { fontSize: 18, fontWeight: '700', color: colors.zinc900 },
  ovText: { fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  ovBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnMain: { backgroundColor: colors.brand },
  btnMainText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnGhost: { backgroundColor: colors.zinc100 },
  btnGhostText: { color: colors.zinc800, fontSize: 16, fontWeight: '600' },
  radio: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.zinc200, paddingHorizontal: 14 },
  radioOn: { borderColor: colors.brand, backgroundColor: '#fff5f6' },
  radioDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  radioIn: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  radioText: { fontSize: 15, fontWeight: '600', color: colors.zinc700 },
});
