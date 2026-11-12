import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { Wordmark } from '@/components/Wordmark';
import { colors } from '@/lib/theme';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'image', title: 'Feed da malta', text: 'Fotos e vídeos de quem segues e do que está a bombar. Sem algoritmo a enganar-te: tu mandas no que vês.' },
  { icon: 'camera', title: 'Mimos', text: 'Mostra o teu dia em 24 horas. Partilha para os amigos chegados ou para toda a gente.' },
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
    document.title = 'Txillapp · A rede social da malta';
    return () => { document.title = prev; };
  }, []);
  const go = (path: string) => router.push(path as never);
  const year = new Date().getFullYear();
  // Computador: duas colunas (texto e entrar à esquerda, a montagem da app à direita). No telemóvel fica como estava.
  if (Platform.OS === 'web' && wide) return <DesktopLanding go={go} year={year} />;

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
          <Text style={st.lead}>A tua vibe, a tua malta e o teu espaço. Fotos, vídeos, mimos, tchekas e chat numa só app, feita para quem não tem tempo a perder.</Text>
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
        <View style={st.footLinks}>
          <Link href="/login" style={st.footLink}>Entrar</Link>
          <Link href="/register" style={st.footLink}>Criar conta</Link>
          <Link href="/forgot-password" style={st.footLink}>Recuperar a senha</Link>
          <Link href="/help" style={st.footLink}>Ajuda</Link>
          <Link href="/terms" style={st.footLink}>Termos de Utilização</Link>
          <Link href="/privacy" style={st.footLink}>Política de Privacidade</Link>
          <Link href={'/apagar-conta' as never} style={st.footLink}>Apagar a conta</Link>
        </View>
        <Text style={[st.footText, { marginTop: 10 }]}>
          <Text onPress={() => void Linking.openURL('mailto:suporte@txillapp.com')} accessibilityRole="link">suporte@txillapp.com</Text>
        </Text>
        <Text style={[st.footText, { marginTop: 8 }]}>© {year} Txillapp</Text>
      </View>
    </ScrollView>
  );
}

/** Onde se instala a app Android (beta, fora da Play Store). */
export const BETA_URL = '/app/beta/';
/** Rodapé da entrada no computador: as ligações legais e de suporte. */
export const LANDING_LEGAL: [string, string][] = [['Termos de Utilização', '/terms'], ['Política de Privacidade', '/privacy'], ['Apagar a conta', '/apagar-conta'], ['Suporte', '/suporte'], ['Ajuda', '/help']];
type Hover = { pressed: boolean; hovered?: boolean };

/** A página de entrada no computador: até 1200 px, duas colunas e o rodapé com as ligações legais. */
function DesktopLanding({ go, year }: { go: (path: string) => void; year: number }) {
  const { width } = useWindowDimensions();
  const big = width >= 1280;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.white }} contentContainerStyle={{ minHeight: '100%' }}>
      <View style={dk.bg} pointerEvents="none">
        <LinearGradient colors={['#fff1f2', '#ffffff']} start={{ x: 0.85, y: 0 }} end={{ x: 0.35, y: 1 }} style={StyleSheet.absoluteFill} />
      </View>
      <View style={dk.wrap}>
        <View style={dk.header}>
          <Pressable onPress={() => go('/')} accessibilityRole="link" accessibilityLabel="Txillapp, página inicial"><Wordmark height={34} /></Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable onPress={() => go('/help')} style={(s) => [dk.navBtn, (s as Hover).hovered && dk.navHover]} accessibilityRole="link"><Text style={dk.navText}>Ajuda</Text></Pressable>
            <Pressable onPress={() => go('/login?entrar=1')} style={(s) => [dk.navBtn, (s as Hover).hovered && dk.navHover]} accessibilityRole="link"><Text style={dk.navText}>Entrar</Text></Pressable>
            <Pressable onPress={() => go('/register')} style={(s) => [dk.navBtn, { backgroundColor: colors.brand }, (s as Hover).hovered && { opacity: 0.9 }]} accessibilityRole="link"><Text style={[dk.navText, { color: '#fff', fontWeight: '700' }]}>Criar conta</Text></Pressable>
          </View>
        </View>

        <View style={[dk.hero, { gap: big ? 64 : 40 }]}>
          <View style={{ flex: 1.05, minWidth: 0 }}>
            <View style={dk.pill}><View style={dk.pillDot} /><Text style={dk.pillText}>A rede social da malta</Text></View>
            <Text style={[dk.h1, big && { fontSize: 68, lineHeight: 72 }]} accessibilityRole="header">Posta. Mostra.{'\n'}<Text style={{ color: colors.brand }}>Txilla.</Text></Text>
            <Text style={dk.lead}>A tua vibe, a tua malta e o teu espaço. Fotos, vídeos, mimos, tchekas e chat numa só app, feita para quem não tem tempo a perder.</Text>
            <View style={dk.cta}>
              <Pressable onPress={() => go('/register')} style={(s) => [st.primary, (s as Hover).hovered && { opacity: 0.92 }, s.pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="link"><Text style={st.primaryText}>Criar conta grátis</Text></Pressable>
              <Pressable onPress={() => go('/login?entrar=1')} style={(s) => [st.secondary, (s as Hover).hovered && { borderColor: colors.zinc300, backgroundColor: '#fafafa' }, s.pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="link"><Text style={st.secondaryText}>Já tenho conta</Text></Pressable>
            </View>
            <View style={dk.stores}>
              <Pressable onPress={() => void Linking.openURL(BETA_URL)} style={(s) => [dk.store, (s as Hover).hovered && dk.storeHover]} accessibilityRole="link" accessibilityLabel="Descarregar a app para Android (beta)">
                <Icon name="download" size={22} color="#fff" />
                <View>
                  <Text style={dk.storeSmall}>Android · beta</Text>
                  <Text style={dk.storeBig}>Descarregar a app</Text>
                </View>
              </Pressable>
              <View style={dk.storeNote}>
                <Icon name="globe" size={20} color={colors.zinc600} />
                <Text style={dk.storeNoteText}>No iPhone e no computador funciona no navegador. Podes instalar no ecrã principal.</Text>
              </View>
            </View>
            <Text style={st.note}>Para maiores de 15 anos.</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Montage />
          </View>
        </View>

        <View style={dk.features}>
          {FEATURES.map((f) => (
            <View key={f.title} style={dk.card}>
              <View style={st.cardIcon}><Icon name={f.icon} size={24} color={colors.brand} /></View>
              <Text style={[st.cardTitle, { fontSize: 18 }]}>{f.title}</Text>
              <Text style={[st.cardText, { fontSize: 15, lineHeight: 23 }]}>{f.text}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ flex: 1 }} />
      <View style={dk.footer}>
        <View style={[dk.wrap, dk.footRow]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Wordmark height={22} />
            <Text style={dk.footText}>© {year} Txillapp</Text>
          </View>
          <View style={dk.footLinks} accessibilityLabel="Ligações legais">
            {LANDING_LEGAL.map(([label, to]) => <Link key={to} href={to as never} style={dk.footLink}>{label}</Link>)}
            <Text onPress={() => void Linking.openURL('mailto:suporte@txillapp.com')} accessibilityRole="link" style={dk.footLink}>suporte@txillapp.com</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

/** Montagem da app (só desenho, sem dados de ninguém): o telemóvel com o feed, um mimo, uma conversa e um presente à volta. */
function Montage() {
  return (
    <View style={{ width: 460, height: 560, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[dk.blob, { right: -20, top: 10, backgroundColor: 'rgba(214,51,79,0.16)' }]} />
      <View style={[dk.blob, { left: -10, bottom: 0, backgroundColor: 'rgba(252,211,77,0.24)' }]} />
      <View style={[st.phone, { width: 290 }]}>
        <View style={st.phoneTop}>
          <Wordmark height={20} />
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 12 }}>
          {[colors.brand, '#fbbf24', '#10b981', '#0ea5e9'].map((c) => <View key={c} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c, borderWidth: 2, borderColor: '#fff' }} />)}
        </View>
        <View style={{ borderRadius: 22, backgroundColor: '#fff', padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.zinc300 }} />
            <View style={{ width: 96, height: 10, borderRadius: 5, backgroundColor: colors.zinc200 }} />
          </View>
          <LinearGradient colors={['#fda4af', colors.brand, '#fcd34d']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ marginTop: 12, aspectRatio: 4 / 5, borderRadius: 14 }} />
          <View style={{ marginTop: 12, flexDirection: 'row', gap: 12 }}>
            <Icon name="cheers" size={22} color={colors.brand} /><Icon name="comment" size={22} color={colors.brand} /><Icon name="gift" size={22} color={colors.brand} />
          </View>
        </View>
      </View>
      {/* Um mimo (vertical), à esquerda. */}
      <View style={[dk.float, { left: 0, top: 70, width: 120, height: 200, padding: 0, overflow: 'hidden', transform: [{ rotate: '-6deg' }] }]}>
        <LinearGradient colors={['#0ea5e9', '#6366f1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={{ flexDirection: 'row', gap: 3, padding: 8 }}>{[1, 0.5, 0.5].map((o, k) => <View key={k} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: `rgba(255,255,255,${o})` }} />)}</View>
        <View style={{ position: 'absolute', left: 10, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="camera" size={16} color="#fff" /><Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Mimo</Text>
        </View>
      </View>
      {/* Uma conversa, à direita. */}
      <View style={[dk.float, { right: 0, top: 150, width: 190, gap: 8, transform: [{ rotate: '4deg' }] }]}>
        <View style={[dk.bubble, { alignSelf: 'flex-start', backgroundColor: colors.zinc100 }]}><Text style={{ fontSize: 13, color: colors.zinc900 }}>Bora txillar hoje?</Text></View>
        <View style={[dk.bubble, { alignSelf: 'flex-end', backgroundColor: colors.brand }]}><Text style={{ fontSize: 13, color: '#fff', fontWeight: '600' }}>Já estou a caminho!</Text></View>
      </View>
      {/* Um presente (Txills), em baixo. */}
      <View style={[dk.float, { right: 30, bottom: 60, flexDirection: 'row', alignItems: 'center', gap: 10, transform: [{ rotate: '-3deg' }] }]}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' }}><Icon name="gift" size={20} color={colors.brand} /></View>
        <View>
          <Text style={{ fontSize: 14, fontWeight: '800', color: colors.zinc900 }}>+50 Txills</Text>
          <Text style={{ fontSize: 12, color: colors.zinc500 }}>Presente da malta</Text>
        </View>
      </View>
    </View>
  );
}

const dk = StyleSheet.create({
  bg: { position: 'absolute', left: 0, right: 0, top: 0, height: 760 },
  wrap: { width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 20 },
  navBtn: { borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  navHover: { backgroundColor: colors.zinc100 },
  navText: { fontSize: 15, fontWeight: '600', color: colors.zinc900 },
  hero: { flexDirection: 'row', alignItems: 'center', paddingTop: 40, paddingBottom: 56 },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.zinc200, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 20 },
  pillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
  pillText: { fontSize: 14, fontWeight: '600', color: colors.zinc600 },
  h1: { fontSize: 60, lineHeight: 64, fontWeight: '800', letterSpacing: -1.5, color: colors.zinc900 },
  lead: { marginTop: 20, maxWidth: 520, fontSize: 19, lineHeight: 30, color: colors.zinc600 },
  cta: { marginTop: 32, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stores: { marginTop: 28, flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  store: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: colors.zinc900, paddingHorizontal: 16, paddingVertical: 9 },
  storeHover: { backgroundColor: '#000', boxShadow: '0 6px 16px rgba(0,0,0,0.18)' },
  storeSmall: { fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  storeBig: { fontSize: 15, color: '#fff', fontWeight: '800' },
  storeNote: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 300 },
  storeNoteText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  blob: { position: 'absolute', width: 300, height: 300, borderRadius: 150, filter: 'blur(40px)' },
  float: { position: 'absolute', borderRadius: 20, backgroundColor: '#fff', padding: 12, boxShadow: '0 18px 40px rgba(0,0,0,0.14)' },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 170 },
  features: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingBottom: 56 },
  card: { width: '31%', flexGrow: 1, borderRadius: 22, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc100, padding: 22 },
  footer: { borderTopWidth: 1, borderTopColor: colors.zinc100, paddingVertical: 24, backgroundColor: '#fff' },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' },
  footLinks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 8 },
  footLink: { fontSize: 14, color: colors.zinc600, fontWeight: '600' },
  footText: { fontSize: 14, color: colors.zinc500 },
});

const st = StyleSheet.create({
  footLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 18, rowGap: 8, paddingHorizontal: 20 },
  footLink: { fontSize: 14, color: colors.zinc600, fontWeight: '600' },
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
