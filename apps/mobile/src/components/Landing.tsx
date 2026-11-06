import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { Wordmark } from '@/components/Wordmark';
import { colors } from '@/lib/theme';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'image', title: 'Feed da malta', text: 'Fotos e vídeos de quem segues e do que está a bombar. Sem algoritmo a enganar-te: tu mandas no que vês.' },
  { icon: 'camera', title: 'Stories', text: 'Mostra o teu dia em 24 horas. Partilha para os amigos chegados ou para toda a gente.' },
  { icon: 'film', title: 'Tchekas', text: 'Vídeos curtos a rolar, um a seguir ao outro. Bora criar a tua.' },
  { icon: 'comment', title: 'Chat em tempo real', text: 'Conversa com quem segues, manda fotos e vídeos. Só entra quem tu deixares.' },
  { icon: 'gift', title: 'Txills', text: 'Oferece presentes à malta que segues e mostra quem está com tudo.' },
  { icon: 'shield', title: 'Privacidade a sério', text: 'Contas privadas, bloquear, silenciar, escolher quem te vê. Tu decides.' },
];

/** A app instalada (PWA) abre direto no login: a apresentação é para quem chega pelo navegador. */
export const isStandaloneWeb = () =>
  Platform.OS !== 'web' ||
  (typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true));

/** Página de apresentação (o site para quem ainda não entrou): igual à do site antigo. */
export function Landing() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 1024;
  const cols = width >= 1024 ? 3 : width >= 640 ? 2 : 1;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const prev = document.title;
    document.title = 'Txillapp — a rede da malta';
    return () => { document.title = prev; };
  }, []);
  const go = (path: string) => router.push(path as never);
  const year = new Date().getFullYear();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.white }} contentContainerStyle={{ paddingTop: insets.top }} showsVerticalScrollIndicator={false}>
      <View style={st.header}>
        <Wordmark height={32} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => go('/login?entrar=1')} style={st.navBtn} accessibilityRole="link"><Text style={st.navText}>Entrar</Text></Pressable>
          {width >= 640 ? <Pressable onPress={() => go('/register')} style={[st.navBtn, { backgroundColor: colors.brand }]} accessibilityRole="link"><Text style={[st.navText, { color: '#fff', fontWeight: '700' }]}>Criar conta</Text></Pressable> : null}
        </View>
      </View>

      <View style={[st.hero, wide && { flexDirection: 'row', alignItems: 'center', paddingTop: 64 }]}>
        <View style={wide ? { flex: 1 } : undefined}>
          <Text style={[st.h1, width >= 640 && { fontSize: 60, lineHeight: 63 }]} accessibilityRole="header">Posta. Mostra. <Text style={{ color: colors.brand }}>Txilla.</Text></Text>
          <Text style={st.lead}>A tua vibe, a tua malta e o teu espaço. Fotos, vídeos, stories, tchekas e chat numa só app, feita para quem não tem tempo a perder.</Text>
          <View style={st.cta}>
            <Pressable onPress={() => go('/register')} style={({ pressed }) => [st.primary, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="link"><Text style={st.primaryText}>Criar conta grátis</Text></Pressable>
            <Pressable onPress={() => go('/login?entrar=1')} style={({ pressed }) => [st.secondary, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="link"><Text style={st.secondaryText}>Já tenho conta</Text></Pressable>
          </View>
          <Text style={st.note}>Para maiores de 15 anos. Funciona no navegador e podes instalar no telemóvel.</Text>
        </View>

        {/* Maqueta do telemóvel, só desenho (sem dados de ninguém). */}
        <View style={[st.mockWrap, wide && { flex: 1, marginTop: 0 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={st.phone}>
            <View style={st.phoneTop}>
              <Wordmark height={20} />
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 12 }}>
              {[colors.brand, '#fbbf24', '#10b981', '#0ea5e9'].map((c) => <View key={c} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c, borderWidth: 2, borderColor: '#fff' }} />)}
            </View>
            <View style={{ borderRadius: 24, backgroundColor: '#fff', padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.zinc300 }} />
                <View style={{ width: 96, height: 10, borderRadius: 5, backgroundColor: colors.zinc200 }} />
              </View>
              <LinearGradient colors={['#fda4af', colors.brand, '#fcd34d']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ marginTop: 12, aspectRatio: 4 / 5, borderRadius: 16 }} />
              <View style={{ marginTop: 12, flexDirection: 'row', gap: 12 }}>
                <Icon name="heart" size={22} color={colors.brand} /><Icon name="comment" size={22} color={colors.brand} /><Icon name="gift" size={22} color={colors.brand} />
              </View>
            </View>
          </View>
        </View>
      </View>

      <View style={st.features}>
        <View style={{ width: '100%', maxWidth: 1152, paddingHorizontal: 20 }}>
          <Text style={st.h2} accessibilityRole="header">Tudo o que a malta precisa</Text>
          <View style={st.grid}>
            {FEATURES.map((f) => (
              <View key={f.title} style={[st.card, { width: cols === 1 ? '100%' : cols === 2 ? '48.8%' : '32.4%' }]}>
                <View style={st.cardIcon}><Icon name={f.icon} size={26} color={colors.brand} /></View>
                <Text style={st.cardTitle}>{f.title}</Text>
                <Text style={st.cardText}>{f.text}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={st.last}>
        <Text style={[st.h2, { textAlign: 'center', marginTop: 0 }]} accessibilityRole="header">Bora entrar na festa?</Text>
        <Text style={st.lastSub}>É grátis e demora menos de um minuto.</Text>
        <Pressable onPress={() => go('/register')} style={({ pressed }) => [st.primary, { marginTop: 24, paddingHorizontal: 40 }, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="link"><Text style={st.primaryText}>Criar a minha conta</Text></Pressable>
      </View>

      <View style={[st.footer, { paddingBottom: 32 + insets.bottom }]}>
        <Text style={st.footText}>
          <Text onPress={() => go('/terms')} accessibilityRole="link">Termos de Uso</Text> · <Text onPress={() => go('/privacy')} accessibilityRole="link">Política de Privacidade</Text> ·{' '}
          <Text onPress={() => void Linking.openURL('mailto:suporte@txillapp.com')} accessibilityRole="link">suporte@txillapp.com</Text>
        </Text>
        <Text style={[st.footText, { marginTop: 8 }]}>© {year} Txillapp</Text>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  header: { width: '100%', maxWidth: 1152, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  navBtn: { borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  navText: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  hero: { width: '100%', maxWidth: 1152, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 32, paddingBottom: 64, gap: 40 },
  h1: { fontSize: 48, lineHeight: 50, fontWeight: '800', letterSpacing: -1, color: colors.zinc900 },
  lead: { marginTop: 20, maxWidth: 512, fontSize: 20, lineHeight: 32, color: colors.zinc600 },
  cta: { marginTop: 32, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  primary: { borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 32, paddingVertical: 16, alignItems: 'center', boxShadow: '0 10px 15px rgba(254,205,211,0.8)' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  secondary: { borderRadius: 999, borderWidth: 2, borderColor: colors.zinc200, paddingHorizontal: 32, paddingVertical: 14, alignItems: 'center' },
  secondaryText: { fontSize: 18, fontWeight: '700', color: colors.zinc900 },
  note: { marginTop: 16, fontSize: 14, color: colors.zinc500 },
  mockWrap: { width: '100%', maxWidth: 300, alignSelf: 'center' },
  phone: { borderRadius: 40, borderWidth: 10, borderColor: colors.zinc900, backgroundColor: colors.zinc100, padding: 12, boxShadow: '0 25px 50px rgba(0,0,0,0.25)' },
  phoneTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 4, paddingBottom: 12 },
  features: { backgroundColor: '#fafafa', paddingVertical: 64, alignItems: 'center' },
  h2: { fontSize: 30, lineHeight: 36, fontWeight: '800', color: colors.zinc900 },
  grid: { marginTop: 32, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: { borderRadius: 24, backgroundColor: '#fff', padding: 24, boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
  cardIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { marginTop: 16, fontSize: 20, fontWeight: '700', color: colors.zinc900 },
  cardText: { marginTop: 6, fontSize: 16, lineHeight: 26, color: colors.zinc600 },
  last: { width: '100%', maxWidth: 768, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 64, alignItems: 'center' },
  lastSub: { marginTop: 12, fontSize: 18, color: colors.zinc600, textAlign: 'center' },
  footer: { borderTopWidth: 1, borderTopColor: colors.zinc100, paddingTop: 32, alignItems: 'center' },
  footText: { fontSize: 14, color: colors.zinc500, textAlign: 'center' },
});
