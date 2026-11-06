import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandLoader } from '@/components/PontoLoader';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AlertHost } from '@/components/AlertHost';
import { installWebAlert } from '@/lib/alertHost';
import { syncPush } from '@/lib/push';
import { useChatStream } from '@/lib/realtime';
import { colors } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync();
installWebAlert();

/**
 * No iPhone (Safari e PWA) o topo do ecrã tem uma zona desfocada do sistema: o conteúdo colado ao topo fica por baixo dela.
 * Na web garantimos pelo menos 20 px de espaço no topo em todos os ecrãs (como já se fazia no site antigo, no perfil).
 */
function WebTopInset({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'web') return <>{children}</>;
  return <SafeAreaInsetsContext.Provider value={{ ...insets, top: Math.max(insets.top, 20) }}>{children}</SafeAreaInsetsContext.Provider>;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

/** Mantém a ligação em tempo real das mensagens (só com sessão iniciada). */
/** A app já arrancou: tira o ecrã de arranque (web). */
function useBootDone() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.getElementById('tx-boot')?.remove();
    try { window.sessionStorage.removeItem('tx_reload'); } catch { /* nada */ }
  }, []);
}

/** Se um ecrã falhar, mostra isto em vez de uma página em branco. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Ups, algo correu mal</Text>
      <Text style={styles.sub}>Já tomámos nota. Tenta outra vez.</Text>
      <Pressable onPress={() => void retry()} style={styles.btn} accessibilityRole="button"><Text style={styles.btnText}>Tentar outra vez</Text></Pressable>
      {Platform.OS === 'web' ? (
        <Pressable onPress={() => window.location.reload()} style={{ marginTop: 12 }} accessibilityRole="button"><Text style={{ color: colors.zinc600, fontSize: 15, textDecorationLine: 'underline' }}>Recarregar a página</Text></Pressable>
      ) : null}
      {__DEV__ ? <Text style={[styles.sub, { marginTop: 16, fontSize: 12 }]}>{error.message}</Text> : null}
    </View>
  );
}

function ChatLive() {
  const { user } = useAuth();
  useChatStream(undefined, !!user);
  // Notificações push (web): volta a ligar a subscrição se já foi dada a permissão.
  useEffect(() => {
    if (user) void syncPush().catch(() => undefined);
  }, [user]);
  return null;
}

/** Sem sessão → entrada; com sessão → a app. */
function Gate() {
  useBootDone();
  const { user, loading, offline, retry } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  useEffect(() => {
    if (loading || offline) return;
    const onLogin = segments[0] === 'login' || segments[0] === 'register' || segments[0] === 'forgot-password' || segments[0] === 'google-username';
    // Links dos emails: servem com ou sem sessão (confirmar conta e repor a senha).
    const onEmailLink = segments[0] === 'verify-email' || segments[0] === 'reset-password';
    // Páginas abertas a todos (termos e privacidade): também com sessão fechada.
    const onPublic = segments[0] === 'terms' || segments[0] === 'privacy';
    if (onEmailLink || onPublic) return;
    if (!user && !onLogin) {
      // Guarda o endereço pedido (por exemplo, uma publicação partilhada) para voltar a ele depois de entrar.
      try {
        if (Platform.OS === 'web') {
          const here = window.location.pathname + window.location.search;
          if (here !== '/' && !here.startsWith('/login')) window.sessionStorage.setItem('tx_return', here);
        }
      } catch {
        /* sem armazenamento: vai para o início */
      }
      router.replace('/login');
    } else if (user && onLogin) {
      let back = '/';
      try {
        if (Platform.OS === 'web') {
          back = window.sessionStorage.getItem('tx_return') || '/';
          window.sessionStorage.removeItem('tx_return');
        }
      } catch {
        back = '/';
      }
      router.replace(back as never);
    }
  }, [user, loading, offline, segments, router]);

  if (loading) return <BrandLoader />;
  if (offline) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Sem ligação</Text>
        <Text style={styles.sub}>Não consegui ligar ao Txillapp. Verifica a internet e tenta outra vez.</Text>
        <Pressable onPress={retry} style={styles.btn} accessibilityRole="button"><Text style={styles.btnText}>Tentar outra vez</Text></Pressable>
      </View>
    );
  }
  return (
    <View style={styles.column}>
      <ChatLive />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.white } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" options={{ animation: 'fade' }} />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="search" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="u/[username]" />
      <Stack.Screen name="p/[id]" />
      <Stack.Screen name="messages/[username]" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="verification" />
      <Stack.Screen name="r/[id]" />
      <Stack.Screen name="reels/filtros" />
      <Stack.Screen name="wallet" />
      <Stack.Screen name="invites" />
      <Stack.Screen name="t/[tag]" />
      <Stack.Screen name="u/[username]/connections" />
      <Stack.Screen name="stories/[username]" options={{ animation: 'fade' }} />
      <Stack.Screen name="stories/new" options={{ animation: 'slide_from_bottom' }} />
    </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <WebTopInset>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="dark" />
            <Gate />
            <AlertHost />
          </AuthProvider>
        </QueryClientProvider>
        </WebTopInset>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  /** Na web (ecrãs largos) a app fica numa coluna de 576 px ao centro, como o site (max-w-xl). */
  column: { flex: 1, width: '100%', maxWidth: 576, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, padding: 32, gap: 10 },
  title: { fontSize: 22, fontWeight: '800', color: colors.zinc900 },
  sub: { fontSize: 15, color: colors.zinc500, textAlign: 'center' },
  btn: { marginTop: 10, backgroundColor: colors.brand, paddingHorizontal: 22, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
