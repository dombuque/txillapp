import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { QrCamera } from '@/components/qr/QrCamera';
import { QrFrame } from '@/components/qr/QrFrame';
import { NO_QR_IN_IMAGE } from '@/lib/qrDecode';
import { readQr, type QrRead } from '@/lib/qrRead';
import { scanImage } from '@/lib/qrScan';
import { useReduceMotion } from '@/lib/reduceMotion';
import { colors } from '@/lib/theme';

const BG = '#0b0b0f';
const web = Platform.OS === 'web';

/** No site, o próprio endereço também é «do Txillapp» (localhost, pré-visualizações). */
const siteHosts = (): string[] => (web && typeof window !== 'undefined' && window.location?.host ? [window.location.host.toLowerCase(), window.location.hostname.toLowerCase()] : []);

/** Site: o seletor de ficheiros do browser (no telemóvel abre a galeria ou as capturas de ecrã). */
function pickWebImage(): Promise<File | null> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const finish = (f: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      done(f);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

const buzz = () => {
  if (web) {
    try {
      (navigator as { vibrate?: (ms: number) => boolean }).vibrate?.(35);
    } catch {
      /* sem vibração */
    }
    return;
  }
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
};

/**
 * Ler um QR: pela câmara ou de uma imagem (o caso de quem recebeu o QR de um perfil como imagem, ou tirou uma captura
 * de ecrã, e o quer ler no próprio telemóvel). Ligação do Txillapp → abre o ecrã certo; outra ligação → pergunta se abre
 * no browser; texto → mostra e copia. Entradas: «Partilhar perfil», a pesquisa e os convites.
 */
export default function QrScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const [result, setResult] = useState<QrRead | null>(null);
  const [hit, setHit] = useState(0);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const going = useRef(false);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  // O resultado (ou o aviso) fica por baixo do visor: num telemóvel pequeno, desce-se até ele.
  useEffect(() => {
    if (!result && !err) return;
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [result, err]);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const flash = (t: string) => {
    setNote(t);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 1800);
  };

  function handle(data: string) {
    if (going.current) return;
    buzz();
    setHit((n) => n + 1);
    setErr('');
    const r = readQr(data, siteHosts());
    setResult(r);
    if (r.kind === 'app') {
      going.current = true;
      // Um instante para se ver a moldura a apertar e o «A abrir…»; depois o ecrã certo, no lugar do leitor.
      setTimeout(() => router.replace(r.path as never), reduce ? 0 : 280);
    }
  }

  async function fromImage(uri: string) {
    setBusy(true);
    setErr('');
    try {
      const data = await scanImage(uri);
      if (data) handle(data);
      else setErr(NO_QR_IN_IMAGE);
    } finally {
      setBusy(false);
    }
  }

  async function pick(crop = false) {
    if (busy) return;
    setResult(null);
    if (web) {
      const f = await pickWebImage();
      if (!f) return;
      const url = URL.createObjectURL(f);
      try {
        await fromImage(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      return;
    }
    try {
      // O seletor do sistema (no Android, o Photo Picker; no iPhone, o das Fotos): não pede licença nenhuma.
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: crop, exif: false });
      const a = r.canceled ? null : r.assets[0];
      if (a) await fromImage(a.uri);
    } catch {
      setErr('Não consegui abrir a galeria. Tenta outra vez.');
    }
  }

  // Site: colar uma captura de ecrã (Ctrl+V / ⌘V) também serve.
  const pasteRef = useRef<(uri: string) => void>(() => undefined);
  useEffect(() => {
    pasteRef.current = (uri: string) => {
      setResult(null);
      void fromImage(uri).finally(() => URL.revokeObjectURL(uri));
    };
  });
  useEffect(() => {
    if (!web || typeof document === 'undefined') return;
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      pasteRef.current(URL.createObjectURL(f));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  async function copy(t: string) {
    try {
      await Clipboard.setStringAsync(t);
      flash('Copiado');
    } catch {
      flash('Não consegui copiar');
    }
  }
  function openOutside(href: string) {
    if (web) window.open(href, '_blank', 'noopener,noreferrer');
    else void Linking.openURL(href).catch(() => flash('Não consegui abrir a ligação'));
  }
  const again = () => {
    going.current = false;
    setResult(null);
    setErr('');
  };

  const col = Math.min(width - 32, 460);
  const finder = Math.min(col, 360);
  const paused = !!result || busy;

  return (
    <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
      <View style={st.bar}>
        <BackButton color="#fff" style={{ backgroundColor: 'transparent' }} />
        <Text style={st.title} accessibilityRole="header">Ler um QR</Text>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView ref={scroller} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: col, alignItems: 'center' }}>
          <View style={[st.finder, { width: finder, height: finder }]} accessible accessibilityLabel="Visor da câmara: aponta ao QR">
            <QrCamera paused={paused} onRead={handle} onLive={setLive} />
            {/* Sem imagem da câmara, a linha não varre por cima do aviso (ficam só os cantos). */}
            <QrFrame size={finder} pulse={hit} reduce={reduce || !live} />
            {busy ? (
              <View style={st.busy}>
                <ActivityIndicator color="#fff" />
                <Text style={st.busyText}>A procurar o QR na imagem…</Text>
              </View>
            ) : null}
          </View>
          <Text style={st.hint}>Aponta a câmara ao QR, ou escolhe a imagem onde ele está.</Text>

          <Pressable onPress={() => void pick()} disabled={busy} style={({ pressed }) => [st.galleryWrap, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button" accessibilityLabel="Escolher da galeria" accessibilityHint="Lê o QR de uma imagem ou captura de ecrã">
            <LinearGradient colors={[colors.brand, colors.brandWarm]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={st.gallery}>
              <View style={st.galleryIcon}><Icon name="image" size={24} color="#fff" /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.galleryText}>Escolher da galeria</Text>
                <Text style={st.gallerySub}>{web ? 'Uma imagem ou captura de ecrã com o QR (também podes colá-la aqui)' : 'Uma imagem ou captura de ecrã com o QR'}</Text>
              </View>
              <Icon name="chevron-right" size={20} color="#fff" />
            </LinearGradient>
          </Pressable>

          {err ? (
            <View style={st.err} accessibilityLiveRegion="polite">
              <Text style={st.errText}>{err}</Text>
              {!web ? (
                <Pressable onPress={() => void pick(true)} style={st.errBtn} accessibilityRole="button">
                  <Text style={st.errBtnText}>Escolher e recortar à volta do QR</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {result ? <ResultCard r={result} onCopy={(t) => void copy(t)} onOpen={openOutside} onAgain={again} /> : null}
          <Text accessibilityLiveRegion="polite" style={st.note}>{note}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function ResultCard({ r, onCopy, onOpen, onAgain }: { r: QrRead; onCopy: (t: string) => void; onOpen: (href: string) => void; onAgain: () => void }) {
  if (r.kind === 'app') {
    return (
      <View style={[st.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.brand} />
        <Text style={st.cardTitle} numberOfLines={2}>A abrir: {r.label}</Text>
      </View>
    );
  }
  const url = r.kind === 'url';
  const body = url ? r.href : r.text;
  return (
    <View style={st.card} accessibilityLiveRegion="polite">
      <Text style={st.cardKicker}>{url ? 'Ligação de fora do Txillapp' : 'Texto do QR'}</Text>
      {url ? <Text style={st.cardTitle} numberOfLines={1}>{r.host}</Text> : null}
      <ScrollView style={{ maxHeight: 160, marginTop: 6 }} nestedScrollEnabled>
        <Text style={st.cardBody} selectable>{body || '(vazio)'}</Text>
      </ScrollView>
      {url ? <Text style={st.ask}>Abrir no browser?</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {url ? (
          <Pressable onPress={() => onOpen(r.href)} style={[st.btn, { backgroundColor: colors.brand }]} accessibilityRole="button" accessibilityLabel={`Abrir ${r.host} no browser`}>
            <Icon name="globe" size={18} color="#fff" />
            <Text style={[st.btnText, { color: '#fff' }]}>Abrir</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => onCopy(body)} disabled={!body} style={st.btn} accessibilityRole="button" accessibilityLabel={url ? 'Copiar a ligação' : 'Copiar o texto'}>
          <Icon name={url ? 'link' : 'file-text'} size={18} />
          <Text style={st.btnText}>Copiar</Text>
        </Pressable>
      </View>
      <Pressable onPress={onAgain} style={st.againBtn} accessibilityRole="button">
        <Icon name="qr-scan" size={18} color={colors.zinc700} />
        <Text style={st.againText}>Ler outro QR</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  bar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '800' },
  finder: { marginTop: 8, borderRadius: 28, overflow: 'hidden', backgroundColor: '#111114' },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.6)' },
  busyText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  hint: { marginTop: 14, color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  galleryWrap: { marginTop: 18, alignSelf: 'stretch', borderRadius: 20, overflow: 'hidden' },
  gallery: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  galleryIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  galleryText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  gallerySub: { marginTop: 2, color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 18 },
  err: { marginTop: 14, alignSelf: 'stretch', borderRadius: 16, padding: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  errText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  errBtn: { marginTop: 10, height: 40, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  errBtnText: { color: colors.zinc900, fontSize: 14, fontWeight: '700' },
  card: { marginTop: 16, alignSelf: 'stretch', borderRadius: 24, backgroundColor: '#fff', padding: 18 },
  cardKicker: { color: colors.zinc500, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardTitle: { flexShrink: 1, marginTop: 2, color: colors.zinc900, fontSize: 18, fontWeight: '800' },
  cardBody: { color: colors.zinc700, fontSize: 15, lineHeight: 21 },
  ask: { marginTop: 12, color: colors.zinc900, fontSize: 15, fontWeight: '700' },
  btn: { flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 12 },
  btnText: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  againBtn: { marginTop: 10, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  againText: { color: colors.zinc700, fontSize: 15, fontWeight: '700' },
  note: { marginTop: 10, minHeight: 20, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: '600' },
});
