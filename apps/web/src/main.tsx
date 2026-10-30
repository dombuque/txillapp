import Reels from './pages/Reels';
import { api } from './lib/api';
import { useQuery } from '@tanstack/react-query';
import AdminStats from './pages/AdminStats';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './index.css';
import DesktopShell from './components/DesktopShell';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import { isStandalone } from './lib/useDesktop';
import { Wordmark } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { GoogleUsername, Login, Register } from './pages/AuthForm';
import Compose from './pages/Compose';
import Connections from './pages/Connections';
import Feed from './pages/Feed';
import Notifications from './pages/Notifications';
import UpdateBanner from './components/UpdateBanner';
import { screenOf, setAnalyticsEnabled, startAnalytics, track } from './lib/analytics';
import InstallPrompt from './components/InstallPrompt';
import ChatLive from './lib/chatLive';
import TagPage from './pages/TagPage';
import Admin from './pages/Admin';
import PostPage from './pages/PostPage';
import { Privacy, Terms } from './pages/Legal';
import Messages from './pages/Messages';
import Thread from './pages/Thread';
import Profile from './pages/Profile';
import Search from './pages/Search';
import Settings from './pages/Settings';
import { ComingSoon } from './pages/Simple';
import Wallet from './pages/Wallet';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

function Splash() {
  const { reconnecting } = useAuth();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-white" aria-busy="true">
      <Wordmark className="h-14" />
      <p role="status" className="text-zinc-500">{reconnecting ? 'A reconectar… 📡' : 'A carregar a vibe…'}</p>
    </main>
  );
}

/** Convite para instalar: só onde não tapa nada (login, registo e separadores principais). */
function Install() {
  const { pathname } = useLocation();
  if (['/login', '/register'].includes(pathname)) return <InstallPrompt className="bottom-4" />;
  if (['/', '/search', '/wallet', '/profile', '/messages'].includes(pathname)) return <InstallPrompt className="bottom-24" />;
  return null;
}

/** Conta os ecrãs vistos (sem ids nem nomes de pessoas) e liga as estatísticas de utilização. */
function Analytics() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const sharing = useQuery({ queryKey: ['privacy'], queryFn: api.privacy, enabled: !!user, staleTime: 5 * 60_000 });
  useEffect(() => {
    startAnalytics();
  }, []);
  useEffect(() => {
    if (sharing.data) setAnalyticsEnabled(sharing.data.shareAnalytics);
  }, [sharing.data]);
  useEffect(() => {
    if (user) track('screen_view', { path: screenOf(pathname) });
  }, [pathname, user]);
  return null;
}

/** Mantém a ligação em tempo real do chat enquanto houver sessão (uma só, em toda a app). */
function Live() {
  const { user } = useAuth();
  return user ? <ChatLive /> : null;
}

/** Só para quem já entrou. Sem sessão → login. */
function Private({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const here = useLocation();
  if (loading) return <Splash />;
  // txillapp.com sem sessão mostra a apresentação; a app instalada vai direto ao login.
  if (!user && here.pathname === '/' && !isStandalone()) return <Landing />;
  // Guarda para onde ia (ex.: um perfil partilhado) e volta lá depois de entrar.
  return user ? <>{children}</> : <Navigate to="/login" replace state={{ from: here.pathname + here.search }} />;
}

/** Login e registo só para quem ainda não entrou: com sessão iniciada vai direto ao feed (só o logout leva ao login). */
function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Live />
        <UpdateBanner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
            <Route path="/google-username" element={<PublicOnly><GoogleUsername /></PublicOnly>} />
            <Route element={<Private><DesktopShell /></Private>}>
              {/* Páginas próprias em ecrã inteiro (como a Atividade do Instagram): sem a barra de baixo. */}
              <Route path="/notifications" element={<Private><Notifications /></Private>} />
              <Route path="/settings" element={<Private><Settings /></Private>} />
              <Route path="/admin/stats" element={<Private><AdminStats /></Private>} />
              <Route path="/reels" element={<Private><Reels /></Private>} />
              <Route path="/tag/:tag" element={<Private><TagPage /></Private>} />
              <Route path="/admin" element={<Private><Admin /></Private>} />
              <Route path="/p/:postId" element={<Private><PostPage /></Private>} />
              <Route path="/messages/:username" element={<Private><Thread /></Private>} />
              <Route path="/u/:username/connections" element={<Private><Connections /></Private>} />
              <Route
                element={
                  <Private>
                    <Layout />
                  </Private>
                }
              >
                <Route path="/" element={<Feed />} />
                <Route path="/new" element={<Compose />} />
                <Route path="/wallet" element={<Wallet />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/u/:username" element={<Profile />} />
                <Route path="/search" element={<Search />} />
                <Route path="/messages" element={<Messages />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Install />
          <Analytics />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
