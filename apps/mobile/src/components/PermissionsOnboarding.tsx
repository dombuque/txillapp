import { Camera } from 'expo-camera';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useState } from 'react';
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { kvGet, kvSet } from '@/lib/kv';
import { inAppGalleryFor } from '@/lib/mediaAccess';
import { askNotifications, onNotificationOpen, registerNativePush } from '@/lib/nativePush';
import { useOverlay } from '@/lib/overlays';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';

const DONE_KEY = 'tx_perms_v1';

/** Já passou pelo passo a passo das permissões neste telemóvel (até lá, nada de lembretes das notificações). */
export const permissionsOnboardingDone = async (): Promise<boolean> => !!(await kvGet(DONE_KEY));

interface Step { id: string; icon: IconName; title: string; text: string; ask: () => Promise<unknown> }
const ALL_STEPS: Step[] = [
  { id: 'notif', icon: 'bell', title: 'Notificações', text: 'Para saberes logo quando a malta te escreve, brinda, comenta ou te segue.', ask: askNotifications },
  {
    id: 'camera', icon: 'camera', title: 'Câmara e microfone', text: 'Para tirares fotos, gravares vídeos, mimos, tchekas e Zás aqui mesmo.',
    ask: async () => { await Camera.requestCameraPermissionsAsync(); await Camera.requestMicrophonePermissionsAsync(); },
  },
  { id: 'photos', icon: 'images', title: 'Fotos e vídeos', text: 'Para escolheres da tua galeria o que queres publicar.', ask: () => MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']) },
  { id: 'location', icon: 'map-pin', title: 'Localização', text: 'Opcional: para te sugerirmos sítios perto e marcares onde estás. Nunca mostramos onde vives.', ask: () => Location.requestForegroundPermissionsAsync() },
];
/** No Android não se pede a galeria: escolhe-se com o seletor de fotos do sistema, que não precisa de licença (lib/mediaAccess). */
const STEPS = ALL_STEPS.filter((s) => s.id !== 'photos' || inAppGalleryFor(Platform.OS));

/**
 * App nativa: depois de entrar pela primeira vez, um passo a passo explica cada permissão antes de o sistema a pedir
 * (notificações, câmara e microfone, fotos, localização). Cada uma pode ficar para depois. Também regista o telemóvel
 * para as notificações a cada arranque e abre o que uma notificação traz quando se toca nela.
 */
export function PermissionsOnboarding() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useOverlay(step !== null);

  useEffect(() => {
    if (Platform.OS === 'web' || !user) return;
    void registerNativePush();
    void kvGet(DONE_KEY).then((v) => { if (!v) setStep(0); });
    // Ao voltar à app (no máximo de 10 em 10 min) regista outra vez: se o servidor apagou o código deste telemóvel,
    // ou se a licença foi dada nas definições do sistema, as notificações voltam sem ser preciso fechar a app.
    let last = Date.now();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || Date.now() - last < 10 * 60_000) return;
      last = Date.now();
      void registerNativePush();
    });
    return () => sub.remove();
  }, [user]);
  useEffect(() => onNotificationOpen((url) => {
    const path = /^https?:\/\//.test(url) ? url.replace(/^https?:\/\/[^/]+/, '') : url;
    router.push(path as never);
  }), [router]);

  if (Platform.OS === 'web' || step === null || !user) return null;
  const s = STEPS[step];
  const next = () => {
    if (step + 1 >= STEPS.length) { void kvSet(DONE_KEY, '1'); setStep(null); } else setStep(step + 1);
  };
  async function allow() {
    setBusy(true);
    try { await s.ask(); } catch { /* recusou ou o sistema não deixou */ }
    setBusy(false);
    next();
  }

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={next}>
      <View style={[st.root, { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <Text style={st.kicker}>Prepara o Txillapp</Text>
        <View style={st.dots}>
          {STEPS.map((x, i) => <View key={x.id} style={[st.dot, i === step && st.dotOn, i < step && { backgroundColor: colors.zinc300 }]} />)}
        </View>
        <View style={st.body}>
          <View style={st.icon}><Icon name={s.icon} size={44} color="#fff" /></View>
          <Text style={st.title}>{s.title}</Text>
          <Text style={st.text}>{s.text}</Text>
        </View>
        <Pressable onPress={() => void allow()} disabled={busy} style={[st.primary, busy && { opacity: 0.6 }]} accessibilityRole="button">
          <Text style={st.primaryText}>Permitir</Text>
        </Pressable>
        <Pressable onPress={next} style={st.later} accessibilityRole="button"><Text style={st.laterText}>Agora não</Text></Pressable>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white, paddingHorizontal: 28 },
  kicker: { textAlign: 'center', fontSize: 14, fontWeight: '800', color: colors.brand, letterSpacing: 0.4 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.zinc200 },
  dotOn: { width: 22, backgroundColor: colors.brand },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 104, height: 104, borderRadius: 32, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 28, fontSize: 26, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  text: { marginTop: 12, fontSize: 17, lineHeight: 25, color: colors.zinc600, textAlign: 'center', maxWidth: 340 },
  primary: { height: 54, borderRadius: 27, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  later: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  laterText: { fontSize: 15, fontWeight: '700', color: colors.zinc600 },
});
