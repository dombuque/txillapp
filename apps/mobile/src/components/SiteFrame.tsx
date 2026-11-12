import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { Wordmark } from './Wordmark';

/** As páginas de texto públicas que, no computador, abrem como página do site (e não na coluna de telemóvel). */
export const SITE_PAGES = ['terms', 'termos', 'privacy', 'privacidade', 'help', 'suporte', 'apagar-conta'] as const;
export const isSitePage = (segment: string | undefined) => !!segment && (SITE_PAGES as readonly string[]).includes(segment);

/** O separador do menu de cima que fica aceso em cada página (os endereços em português e em inglês são a mesma página). */
export function siteTabOf(segment: string | undefined): 'terms' | 'privacy' | 'help' | 'delete' | null {
  switch (segment) {
    case 'terms':
    case 'termos': return 'terms';
    case 'privacy':
    case 'privacidade': return 'privacy';
    case 'help':
    case 'suporte': return 'help';
    case 'apagar-conta': return 'delete';
    default: return null;
  }
}

const NAV: { key: 'terms' | 'privacy' | 'help' | 'delete'; label: string; to: string }[] = [
  { key: 'terms', label: 'Termos', to: '/termos' },
  { key: 'privacy', label: 'Privacidade', to: '/privacidade' },
  { key: 'help', label: 'Ajuda', to: '/suporte' },
  { key: 'delete', label: 'Apagar a conta', to: '/apagar-conta' },
];
type Hover = { pressed: boolean; hovered?: boolean };

/**
 * No computador, os Termos, a Privacidade, a Ajuda e o apagar a conta abrem como página do site: barra de cima com o
 * logótipo, o menu destas páginas e entrar/criar conta (ou voltar à app), e o texto numa coluna de leitura larga.
 * Antes abriam na coluna de 576 px, como no telemóvel.
 */
export function SiteFrame({ segment, children }: { segment: string | undefined; children: ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  usePathname(); // volta a desenhar o menu ao mudar de página
  const tab = siteTabOf(segment);
  const go = (to: string) => router.replace(to as never);
  return (
    <View style={st.root}>
      <View style={st.bar}>
        <View style={st.barIn}>
          <Pressable onPress={() => router.replace('/' as never)} accessibilityRole="link" accessibilityLabel="Txillapp, página inicial"><Wordmark height={28} /></Pressable>
          <View style={st.nav} accessibilityRole="tablist">
            {NAV.map((n) => (
              <Pressable key={n.key} onPress={() => go(n.to)} accessibilityRole="tab" accessibilityState={{ selected: tab === n.key }} style={(s) => [st.navBtn, tab === n.key && st.navOn, (s as Hover).hovered && tab !== n.key && st.navHover]}>
                <Text style={[st.navText, tab === n.key && st.navTextOn]}>{n.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={st.right}>
            {user ? (
              <Pressable onPress={() => router.replace('/' as never)} style={(s) => [st.cta, (s as Hover).hovered && { opacity: 0.9 }]} accessibilityRole="link"><Text style={st.ctaText}>Voltar ao Txillapp</Text></Pressable>
            ) : (
              <>
                <Pressable onPress={() => router.push('/login?entrar=1' as never)} style={(s) => [st.navBtn, (s as Hover).hovered && st.navHover]} accessibilityRole="link"><Text style={st.navText}>Entrar</Text></Pressable>
                <Pressable onPress={() => router.push('/register' as never)} style={(s) => [st.cta, (s as Hover).hovered && { opacity: 0.9 }]} accessibilityRole="link"><Text style={st.ctaText}>Criar conta</Text></Pressable>
              </>
            )}
          </View>
        </View>
      </View>
      <View style={st.page}>{children}</View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, width: '100%', backgroundColor: colors.white },
  bar: { borderBottomWidth: 1, borderBottomColor: colors.zinc100, backgroundColor: colors.white },
  barIn: { width: '100%', maxWidth: 1200, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 24, paddingHorizontal: 32, paddingVertical: 14 },
  nav: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  navBtn: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  navHover: { backgroundColor: colors.zinc100 },
  navOn: { backgroundColor: colors.rose50 },
  navText: { fontSize: 15, fontWeight: '600', color: colors.zinc700 },
  navTextOn: { color: colors.brand },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cta: { borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 18, paddingVertical: 9 },
  ctaText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  /** A coluna de leitura: mais larga do que a do telemóvel, mas sem linhas compridas demais. */
  page: { flex: 1, width: '100%', maxWidth: 860, alignSelf: 'center' },
});
