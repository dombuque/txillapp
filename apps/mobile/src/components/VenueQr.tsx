import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { Icon } from '@/components/Icon';
import { locaisApi, type Venue } from '@/lib/api.locais';
import { qrMatrix } from '@/lib/qr';
import { SITE_URL } from '@/lib/config';
import { cardShadow, colors } from '@/lib/theme';

/** O endereço do site para pôr nos QR (na web o da própria página). */
export const origin = () => (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : SITE_URL || 'https://txillapp.com');

function matrix(text: string): { bits: Uint8Array; n: number } | null {
  try {
    const rows = qrMatrix(text);
    const n = rows.length;
    const bits = new Uint8Array(n * n);
    rows.forEach((r, y) => r.forEach((on, x) => { bits[y * n + x] = on ? 1 : 0; }));
    return { bits, n };
  } catch {
    return null;
  }
}

/** Desenha o QR (módulos escuros em fundo branco, com margem de 1 módulo). */
export function QrSvg({ text, size }: { text: string; size: number }) {
  const m = useMemo(() => matrix(text), [text]);
  if (!m) return <View style={{ width: size, height: size, backgroundColor: colors.zinc100, borderRadius: 16 }} />;
  const rects = [];
  for (let y = 0; y < m.n; y++) for (let x = 0; x < m.n; x++) if (m.bits[y * m.n + x]) rects.push(<Rect key={`${x}-${y}`} x={x + 1} y={y + 1} width={1.02} height={1.02} fill={colors.zinc900} />);
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${m.n + 2} ${m.n + 2}`}>
      <Rect x={0} y={0} width={m.n + 2} height={m.n + 2} fill="#fff" />
      {rects}
    </Svg>
  );
}

/** Na web: descarrega o QR como SVG (para imprimir). */
export function downloadQrSvg(text: string, filename: string) {
  const m = matrix(text);
  if (!m) return;
  let d = '';
  for (let y = 0; y < m.n; y++) for (let x = 0; x < m.n; x++) if (m.bits[y * m.n + x]) d += `M${x + 1} ${y + 1}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.n + 2} ${m.n + 2}" width="720" height="720"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#18181b"/></svg>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Cartão do QR do local (para o dono imprimir): quem o lê, no local, faz check-in. */
export function VenueQr({ venue }: { venue: Venue }) {
  const qc = useQueryClient();
  const url = `${origin()}/v/${venue.slug}?k=${venue.qrToken}`;
  const [busy, setBusy] = useState(false);

  async function save() {
    if (Platform.OS === 'web') {
      downloadQrSvg(url, `txillapp-${venue.slug}.svg`);
      return;
    }
    try {
      await Share.share({ message: `Faz check-in no Txillapp: ${venue.name}\n${url}`, url });
    } catch {
      /* cancelado */
    }
  }
  async function doRotate() {
    setBusy(true);
    await locaisApi.rotateVenueQr(venue.slug).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['venue', venue.slug] });
    setBusy(false);
  }
  function rotate() {
    const msg = 'O QR impresso deixa de funcionar e tens de imprimir o novo.';
    if (Platform.OS === 'web') {
      if (window.confirm(`Mudar o QR? ${msg}`)) void doRotate();
      return;
    }
    Alert.alert('Mudar o QR?', msg, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Mudar o QR', style: 'destructive', onPress: () => void doRotate() },
    ]);
  }

  return (
    <View style={st.card} accessibilityLabel="QR do local">
      <Text style={{ fontWeight: '800', fontSize: 16, color: colors.zinc900 }}>O QR do teu local</Text>
      <Text style={{ marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.zinc600 }}>Imprime-o e põe-no no local. Quem o ler faz check-in. Só tu vês este QR.</Text>
      <View style={{ marginTop: 12, alignSelf: 'center', width: '100%', maxWidth: 240, aspectRatio: 1 }}>
        <QrSvg text={url} size={240} />
      </View>
      <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => void save()} style={[st.btn, { flex: 1, backgroundColor: colors.zinc900, gap: 8 }]} accessibilityRole="button">
          <Icon name="download" size={18} color="#fff" />
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{Platform.OS === 'web' ? 'Guardar para imprimir' : 'Partilhar para imprimir'}</Text>
        </Pressable>
        <Pressable onPress={rotate} disabled={busy} style={[st.btn, { paddingHorizontal: 16, backgroundColor: colors.zinc100, opacity: busy ? 0.6 : 1 }]} accessibilityRole="button">
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc800 }}>Mudar o QR</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 16, borderRadius: 24, backgroundColor: colors.white, padding: 16, ...cardShadow },
  btn: { height: 44, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
