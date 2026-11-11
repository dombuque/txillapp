import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PlacePickMap } from '@/components/nearby/PlacePickMap';
import { Sheet, useSheetScroll } from '@/components/Sheet';
import type { Profile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { devicePosition, type LatLng } from '@/lib/devicePosition';
import { startCity } from '@/lib/cities';
import { PLACE_LABEL_MAX, PRIVACY_NOTE, cleanPlaceLabel, type PlaceChoice } from '@/lib/groupAccess';
import { kvGet } from '@/lib/kv';
import { colors } from '@/lib/theme';
import { ErrText, Field, Pill } from './GroupParts';

/**
 * O passo "Onde é o grupo?" (antes de "Guardar" num modo do mapa): usar o local do Plano ou marcar no mapa.
 * `onKeep` (quando já há sítio e se está a mudar) mostra "Manter o sítio".
 */
export function PlaceStep({ onVenue, onMap, onKeep }: { onVenue: () => void; onMap: () => void; onKeep?: () => void }) {
  return (
    <View style={s.step} accessibilityLabel="Onde é o grupo?">
      <Text style={s.stepTitle} accessibilityRole="header">Onde é o grupo?</Text>
      <Text style={s.stepText}>Para aparecer em À tua volta, o grupo precisa de um sítio no mapa.</Text>
      <Pill label="Usar o local do plano" icon="store" kind="soft" onPress={onVenue} />
      <Pill label="Marcar no mapa" icon="map-pin" kind="soft" onPress={onMap} />
      <View style={s.note}>
        <Icon name="lock" size={14} color={colors.zinc500} />
        <Text style={s.noteText}>{PRIVACY_NOTE}</Text>
      </View>
      {onKeep ? (
        <Pressable onPress={onKeep} style={s.keep} accessibilityRole="button" hitSlop={6}>
          <Text style={s.keepText}>Manter o sítio</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "Aparece em: Costa do Sol · Mudar" (administradores) ou só o selo do sítio (os outros membros, sem `onChange`). */
export function PlaceRow({ label, pending, onChange }: { label: string | null; pending?: boolean; onChange?: () => void }) {
  const text = label ?? 'zona marcada no mapa';
  return (
    <View style={s.row} accessibilityLabel={`Aparece em ${text}${pending ? ', por guardar' : ''}`}>
      <Icon name="map-pin" size={16} color={colors.brand} />
      <Text style={s.rowText} numberOfLines={1}>
        <Text style={s.rowDim}>Aparece em: </Text>
        {text}
        {pending ? <Text style={s.rowDim}>  · por guardar</Text> : null}
      </Text>
      {onChange ? (
        <Pressable onPress={onChange} hitSlop={8} accessibilityRole="button" accessibilityLabel="Mudar o sítio do grupo">
          <Text style={s.rowLink}>Mudar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * "Marcar no mapa": um mapa pequeno com o alfinete fixo ao centro (arrasta-se o mapa), centrado na posição do aparelho se
 * houver permissão, senão na cidade da pessoa. Nome do sítio opcional (até 80). O ponto vai arredondado; o servidor arredonda-o
 * ainda a ~1,5 km.
 */
export function MapPointSheet({ initial, onPick, onClose }: { initial?: (LatLng & { label?: string | null }) | null; onPick: (c: Extract<PlaceChoice, { kind: 'point' }>) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [center, setCenter] = useState<LatLng | null>(initial ? { lat: initial.lat, lng: initial.lng } : null);
  const [point, setPoint] = useState<LatLng | null>(initial ? { lat: initial.lat, lng: initial.lng } : null);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Onde abre: o sítio já marcado; senão a posição do aparelho (sem pedir); senão a cidade (À tua volta, perfil) ou Maputo.
  useEffect(() => {
    if (initial) return;
    void (async () => {
      const here = await devicePosition(false);
      if (!alive.current) return;
      if (here) { setCenter(here); return; }
      const chosen = await kvGet('txill.perto.place').catch(() => null);
      const profileCity = user ? qc.getQueryData<Profile>(['profile', user.username])?.city : null;
      if (!alive.current) return;
      setCenter((c) => c ?? startCity(chosen, profileCity));
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function mine() {
    setErr('');
    setLocating(true);
    const here = await devicePosition(true);
    if (!alive.current) return;
    setLocating(false);
    if (here) setCenter(here);
    else setErr('Não consegui saber onde estás. Arrasta o mapa até ao sítio ou liga a localização.');
  }

  function use() {
    if (!point) return;
    onPick({ kind: 'point', lat: point.lat, lng: point.lng, label: cleanPlaceLabel(label) || null });
    onClose();
  }

  return (
    <Sheet title="Marcar no mapa" onClose={onClose} full>
      {/* Sem ScrollView: o mapa apanha os gestos todos; com o teclado aberto o mapa encolhe. */}
      <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: 8, gap: 12 }}>
        <Text style={s.stepText}>Arrasta o mapa até o alfinete ficar no sítio do grupo.</Text>
        {center ? <MapBox center={center} onMove={setPoint} /> : <View style={[s.map, s.mapWait]}><Text style={s.noteText}>A abrir o mapa…</Text></View>}
        <Pill label={locating ? 'A procurar…' : 'Ir para a minha posição'} icon="locate" kind="soft" small busy={locating} onPress={() => void mine()} style={{ alignSelf: 'flex-start' }} />
        <ErrText text={err} />
        <Field value={label} onChangeText={setLabel} maxLength={PLACE_LABEL_MAX} placeholder="Nome do sítio (opcional) · ex.: Costa do Sol" accessibilityLabel="Nome do sítio, opcional" returnKeyType="done" onSubmitEditing={use} />
        <View style={s.note}>
          <Icon name="lock" size={14} color={colors.zinc500} />
          <Text style={s.noteText}>{PRIVACY_NOTE}</Text>
        </View>
        <Pill label="Usar este sítio" onPress={use} disabled={!point} />
      </View>
    </Sheet>
  );
}

/** O mapa dentro da folha: enquanto o dedo está no mapa, arrastar para baixo mexe o mapa e não fecha a folha. */
function MapBox({ center, onMove }: { center: LatLng; onMove: (c: LatLng) => void }) {
  const sheet = useSheetScroll();
  const hold = () => { if (sheet) sheet.top.current = false; };
  const free = () => { if (sheet) sheet.top.current = true; };
  return (
    <View
      style={s.map}
      onTouchStart={hold}
      onTouchEnd={free}
      onTouchCancel={free}
      accessible={Platform.OS !== 'web'}
      accessibilityLabel="Mapa para marcar o sítio do grupo. Arrasta o mapa para mover o alfinete."
    >
      <PlacePickMap center={center} onMove={onMove} style={{ flex: 1 }} />
    </View>
  );
}

const s = StyleSheet.create({
  step: { gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white },
  stepTitle: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  stepText: { fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  keep: { alignSelf: 'center', paddingVertical: 4 },
  keepText: { fontSize: 14, fontWeight: '700', color: colors.zinc700 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.zinc100 },
  rowText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  rowDim: { fontWeight: '500', color: colors.zinc600 },
  rowLink: { fontSize: 14, fontWeight: '800', color: colors.brand, paddingHorizontal: 4 },
  map: { flex: 1, minHeight: 150, maxHeight: 340, borderRadius: 16, overflow: 'hidden', backgroundColor: '#f2efe9' },
  mapWait: { alignItems: 'center', justifyContent: 'center' },
});
