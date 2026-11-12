import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { SITE_URL } from '@/lib/config';
import { qrMatrix } from '@/lib/qr';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { Wordmark } from './Wordmark';
import { Sheet } from './Sheet';
import { linkShare } from '@/lib/shareLink';

const INK = '#18181b';

/** Símbolo do QR (três cantos e pontos), no mesmo traço dos outros ícones: para o botão do perfil. */
export function QrGlyph({ size = 20, color = colors.zinc900 }: { size?: number; color?: string }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3.5} y={3.5} width={6} height={6} rx={1.2} />
      <Rect x={14.5} y={3.5} width={6} height={6} rx={1.2} />
      <Rect x={3.5} y={14.5} width={6} height={6} rx={1.2} />
      <Path d="M14.5 14.5h2.5v2.5M20.5 14.5v.01M14.5 20.5h.01M17.5 20.5h3M20.5 17.5v3" />
    </Svg>
  );
}

/** O QR desenhado com react-native-svg: um só traço com todos os módulos escuros, mais 1 módulo de margem (como no site). */
export function QrCode({ value, size, color = INK }: { value: string; size: number; color?: string }) {
  const { path, n } = useMemo(() => {
    const m = qrMatrix(value);
    let d = '';
    m.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (!row[x]) {
          x++;
          continue;
        }
        let w = 1;
        while (x + w < row.length && row[x + w]) w++;
        d += `M${x + 1} ${y + 1}h${w}v1h-${w}z`;
        x += w;
      }
    });
    return { path: d, n: m.length + 2 };
  }, [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
      <Rect x={0} y={0} width={n} height={n} fill="#fff" />
      <Path d={path} fill={color} />
    </Svg>
  );
}

/** Partilhar o perfil com um QR: quem o lê abre o teu perfil. Também se partilha ou copia a ligação. */
export function ProfileQrSheet({ username, displayName, onClose }: { username: string; displayName: string; onClose: () => void }) {
  const origin = SITE_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://txillapp.com');
  const url = `${origin}/u/${username}`;
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (t: string) => {
    setNote(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(''), 2000);
  };
  async function share() {
    const text = `Segue @${username} no Txillapp, a rede da malta:`;
    try {
      await Share.share({ title: `${displayName} no Txillapp`, ...linkShare(text, url) });
    } catch {
      flash('Não consegui partilhar');
    }
  }
  async function copy() {
    try {
      await Clipboard.setStringAsync(url);
      flash('Ligação copiada');
    } catch {
      flash('Não consegui copiar');
    }
  }
  return (
    <Sheet title="Partilhar perfil" onClose={onClose}>
      <View style={{ paddingHorizontal: 24 }}>
        <View style={st.card}>
          <View accessibilityRole="image" accessibilityLabel={`QR do perfil de ${username}`}>
            <QrCode value={url} size={238} />
          </View>
          <Text style={st.user} numberOfLines={1}>@{username}</Text>
          {/* O logótipo oficial (o mesmo do cartão do convite e da entrada), não o nome escrito à mão. */}
          <View style={st.brand} accessible accessibilityRole="image" accessibilityLabel="Txillapp"><Wordmark height={22} /></View>
        </View>
        <Text style={st.hint}>Aponta a câmara ao QR para abrir o perfil.</Text>
        <View style={{ marginTop: 16, flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => void share()} accessibilityRole="button" style={st.btn}>
            <Icon name="share" size={18} />
            <Text style={st.btnText}>Partilhar</Text>
          </Pressable>
          <Pressable onPress={() => void copy()} accessibilityRole="button" style={st.btn}>
            <Icon name="link" size={18} />
            <Text style={st.btnText}>Copiar</Text>
          </Pressable>
        </View>
        <Text accessibilityLiveRegion="polite" style={st.note}>{note}</Text>
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  card: { alignSelf: 'center', width: '100%', maxWidth: 300, alignItems: 'center', borderRadius: 24, backgroundColor: '#fff', padding: 20, borderWidth: 1, borderColor: colors.zinc100, boxShadow: '0 2px 16px rgba(0,0,0,0.12)' },
  user: { marginTop: 12, fontSize: 20, lineHeight: 28, fontWeight: '800', color: colors.zinc900 },
  brand: { marginTop: 6, alignItems: 'center' },
  hint: { marginTop: 12, textAlign: 'center', fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  btn: { flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 12 },
  btnText: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  note: { marginTop: 8, minHeight: 20, textAlign: 'center', fontSize: 14, fontWeight: '600', color: colors.zinc700 },
});
