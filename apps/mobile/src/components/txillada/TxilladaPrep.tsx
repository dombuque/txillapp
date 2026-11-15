import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { useKeyboardHeight } from '@/components/StoryParts';
import { ApiError } from '@/lib/api';
import { txilladaApi, txilladaKey } from '@/lib/api.txillada';
import { useDesktop } from '@/lib/desktop';
import { storyFrame } from '@/lib/storyFrame';
import { colors } from '@/lib/theme';
import { AUDIENCES, TITLE_MAX, cleanTitle, errorText, titleError, type TxilladaAudience } from '@/lib/txillada';
import { handOff, usePreview } from '@/lib/txilladaRoom';
import { GlassButton, LiveBadge } from './TxilladaParts';
import { TxilladaVideo } from './TxilladaVideo';

/**
 * Preparar uma Txillada (Criar → TXILLADA): a câmara à vista no cartão 9:16, o título (até 80 letras), quem pode ver
 * (Todos / Seguidores / Amigos próximos) e «Começar Txillada». Ao começar, a câmara passa para o ecrã do live
 * (app/txillada/[id]) sem fechar. Por baixo do cartão, os modos de Criar, como nas câmaras.
 */
export function TxilladaPrep({ active, onClose, kinds, kind, onKind }: { active: boolean; onClose: () => void; kinds?: { id: string; label: string }[]; kind?: string; onKind?: (id: string) => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = useDesktop();
  const router = useRouter();
  const qc = useQueryClient();
  const kb = useKeyboardHeight();
  const preview = usePreview(active);
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<TxilladaAudience>('everyone');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const frame = storyFrame({ w: width, h: height, top: insets.top, bottom: insets.bottom, wide });
  const hint = AUDIENCES.find((a) => a.id === audience)?.hint ?? '';

  async function start() {
    const bad = titleError(title);
    if (bad) { setMsg(bad); return; }
    if (!preview.tracks) { setMsg(preview.error ?? 'A câmara ainda está a abrir.'); return; }
    setBusy(true);
    setMsg(null);
    try {
      const r = await txilladaApi.start(cleanTitle(title), audience);
      const tracks = preview.keep();
      handOff(r.txillada.id, { token: r.token, url: r.url }, tracks, preview.front);
      qc.setQueryData(txilladaKey(r.txillada.id), r.txillada);
      // Fica em TXILLADA por baixo (sem abrir outra câmara enquanto a do live está ligada); fora de foco, este ecrã sai.
      router.push(`/txillada/${r.txillada.id}` as never);
      setTitle('');
    } catch (e) {
      // 409 com `id`: já tenho uma a decorrer (noutro aparelho, ou a app fechou a meio). Volto a entrar nela como
      // anfitrião, com a câmara que já está aberta aqui (o join dá ao anfitrião o token com canPublish).
      const running = e instanceof ApiError && e.status === 409 && typeof e.extra?.id === 'string' ? (e.extra.id as string) : null;
      if (running) {
        try {
          const access = await txilladaApi.join(running);
          handOff(running, access, preview.keep(), preview.front);
          router.push(`/txillada/${running}` as never);
          setTitle('');
        } catch (j) {
          setMsg(j instanceof ApiError ? errorText(j.status, j.message) : errorText(undefined));
        }
        return;
      }
      setMsg(e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined));
    } finally {
      setBusy(false);
    }
  }

  const lift = Platform.OS !== 'web' && kb ? Math.max(0, kb - (height - (frame.cardTop + frame.cardH))) + 8 : 0;
  return (
    <View style={st.screen}>
      <View style={[st.card, { left: frame.cardLeft, top: frame.cardTop, width: frame.cardW, height: frame.cardH, borderRadius: frame.radius }]}>
        <TxilladaVideo track={preview.tracks?.video ?? null} mirror={preview.front} style={StyleSheet.absoluteFill} />
        {!preview.tracks && !preview.error ? <View style={[StyleSheet.absoluteFill, st.center]}><ActivityIndicator color="#fff" /></View> : null}
        {preview.error ? (
          <View style={[StyleSheet.absoluteFill, st.center, { paddingHorizontal: 24 }]}>
            <Icon name="camera" size={34} color="#fff" />
            <Text style={st.problem}>{preview.error}</Text>
            <Pressable onPress={preview.retry} style={st.retry} accessibilityRole="button"><Text style={st.retryText}>Tentar outra vez</Text></Pressable>
          </View>
        ) : null}

        <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent']} style={st.top} pointerEvents="box-none">
          <GlassButton icon="x" label="Fechar" onPress={onClose} />
          <View style={{ flex: 1, alignItems: 'center' }} pointerEvents="none"><Text style={st.heading}>Txillada</Text></View>
          <GlassButton icon="cam-flip" label="Virar a câmara" onPress={() => void preview.flip()} />
        </LinearGradient>

        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.72)']} style={[st.bottom, { transform: [{ translateY: -lift }] }]} pointerEvents="box-none">
          <View style={st.badgeLine} pointerEvents="none"><LiveBadge small /><Text style={st.badgeHint}>Ao vivo, sem gravar</Text></View>
          <View style={st.field}>
            <TextInput
              value={title}
              onChangeText={(t) => { setTitle(t.slice(0, TITLE_MAX)); if (msg) setMsg(null); }}
              maxLength={TITLE_MAX}
              placeholder="Dá um título à tua Txillada"
              placeholderTextColor="rgba(255,255,255,0.6)"
              style={st.input}
              returnKeyType="done"
              accessibilityLabel="Título da Txillada"
            />
            <Text style={st.count}>{TITLE_MAX - title.length}</Text>
          </View>
          <View style={st.audRow} accessibilityRole="radiogroup" accessibilityLabel="Quem pode ver">
            {AUDIENCES.map((a) => {
              const on = audience === a.id;
              return (
                <Pressable key={a.id} onPress={() => setAudience(a.id)} style={[st.aud, on && st.audOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  {a.id === 'close' ? <Icon name="star" size={13} color={on ? '#fff' : 'rgba(255,255,255,0.8)'} strokeWidth={2.2} /> : null}
                  <Text style={[st.audText, on && st.audTextOn]} numberOfLines={1}>{a.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={st.hint}>{hint}</Text>
          {msg ? <Text style={st.msg} accessibilityRole="alert">{msg}</Text> : null}
          <Pressable onPress={() => void start()} disabled={busy} style={({ pressed }) => [st.go, (busy || !preview.tracks) && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <><Icon name="txillada" size={22} color="#fff" strokeWidth={2.1} /><Text style={st.goText}>Começar Txillada</Text></>}
          </Pressable>
        </LinearGradient>
      </View>

      {kinds && onKind ? (
        <View style={[st.modes, { top: frame.barTop, height: frame.barH, left: frame.cardLeft, width: frame.cardW }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.kinds} accessibilityRole="tablist">
            {kinds.map((kd) => (
              <Pressable key={kd.id} onPress={() => onKind(kd.id)} style={st.kindPill} accessibilityRole="tab" accessibilityLabel={kd.label} accessibilityState={{ selected: kind === kd.id }} hitSlop={6}>
                <Text style={[st.kindText, kind === kd.id && st.kindOn]}>{kd.label.toUpperCase()}</Text>
                <View style={[st.kindDot, kind !== kd.id && { opacity: 0 }]} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  card: { position: 'absolute', overflow: 'hidden', backgroundColor: colors.zinc900 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  problem: { color: '#fff', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  retry: { marginTop: 6, height: 42, paddingHorizontal: 20, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 28 },
  heading: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 40, paddingBottom: 16, gap: 10 },
  badgeLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badgeHint: { color: 'rgba(255,255,255,0.8)', fontSize: 12.5, fontWeight: '600' },
  field: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(14,14,18,0.5)', paddingRight: 14 },
  input: { flex: 1, minWidth: 0, height: 46, paddingLeft: 18, paddingRight: 8, color: '#fff', fontSize: 16, fontWeight: '600', outlineStyle: 'none' as never },
  count: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  audRow: { flexDirection: 'row', gap: 6 },
  aud: { flex: 1, minWidth: 0, height: 36, flexDirection: 'row', gap: 4, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(14,14,18,0.42)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  audOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  audText: { color: 'rgba(255,255,255,0.86)', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  audTextOn: { color: '#fff' },
  hint: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, textAlign: 'center', marginTop: -2 },
  msg: { color: '#fff', backgroundColor: 'rgba(220,38,38,0.85)', borderRadius: 12, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  go: { height: 52, borderRadius: 26, backgroundColor: colors.brand, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(214,51,79,0.45)' } as object,
  goText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  modes: { position: 'absolute', justifyContent: 'center' },
  kinds: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 0, paddingHorizontal: 6 },
  kindPill: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', gap: 4 },
  kindDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.brand },
  kindText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  kindOn: { color: '#fff' },
});
