import Reels from './pages/Reels';
import { api } from './lib/api';
import { useQuery } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy, type ReactNode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './index.css';
import DesktopShell from './components/DesktopShell';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import { isStandalone } from './lib/useDesktop';
import InstallGate, { installRequired } from './pages/InstallGate';
import { neutralizeInstallOnSite, useInstall } from './lib/install';
import { syncPush } from './lib/push';
import { BrandLoader, TopLoader } from './components/Loading';
import { AuthProvider, useAuth } from './lib/auth';
import { GoogleUsername, Login, Register } from './pages/AuthForm';
import Compose from './pages/Compose';
import ReelPage from './pages/ReelPage';
import GeleiraEditor from './pages/GeleiraEditor';
import CameraStudio from './components/CameraStudio';
import Connections from './pages/Connections';
import Feed from './pages/Feed';
import Notifications from './pages/Notifications';
import UpdateBanner from './components/UpdateBanner';
import SwipeClose from './components/SwipeClose';
import { screenOf, setAnalyticsEnabled, startAnalytics, track } from './lib/analytics';
import InstallPrompt from './components/InstallPrompt';
import ChatLive from './lib/chatLive';
import TagPage from './pages/TagPage';
import PostPage from './pages/PostPage';
import { ForgotPassword, ResetPassword, VerifyEmail } from './pages/EmailPages';
import { Privacy, Terms } from './pages/Legal';
import Messages from './pages/Messages';
import Thread from './pages/Thread';
import Profile from './pages/Profile';
import Search from './pages/Search';
import Settings from './pages/Settings';
import { ComingSoon } from './pages/Simple';
import Wallet from './pages/Wallet';

const AdminStats = lazy(() => import('./pages/AdminStats'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminVerifications = lazy(() => import('./pages/AdminVerifications'));
const Verification = lazy(() => import('./pages/Verification'));
const PublicPost = lazy(() => import('./pages/PublicPost'));
const PlacePage = lazy(() => import('./pages/PlacePage'));
const Insights = lazy(() => import('./pages/Insights'));
const SavedPosts = lazy(() => import('./pages/SavedPosts'));
const ReelPrefs = lazy(() => import('./pages/ReelPrefs'));
const VenuePage = lazy(() => import('./pages/VenuePage'));
const Venues = lazy(() => import('./pages/Venues'));
const Invites = lazy(() => import('./pages/Invites'));
const BoLayout = lazy(() => import('./pages/backoffice/Layout'));
const BoHome = lazy(() => import('./pages/backoffice/Home'));
const BoReports = lazy(() => import('./pages/backoffice/Reports'));
const BoUsers = lazy(() => import('./pages/backoffice/Users'));
const BoUser = lazy(() => import('./pages/backoffice/UserSheet'));
const BoAudit = lazy(() => import('./pages/backoffice/Audit'));
const BoTeam = lazy(() => import('./pages/backoffice/Team'));
const SupportAbout = lazy(() => import('./pages/Support').then((m) => ({ default: m.About })));
const SupportHelp = lazy(() => import('./pages/Support').then((m) => ({ default: m.Help })));
const SupportOrders = lazy(() => import('./pages/Support').then((m) => ({ default: m.Orders })));
const SupportLanguage = lazy(() => import('./pages/Support').then((m) => ({ default: m.Language })));

neutralizeInstallOnSite();

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

function Splash() {
  const { reconnecting } = useAuth();
  return <BrandLoader message={reconnecting ? 'A reconectar…' : 'A carregar a vibe…'} />;
}

/** Em app.txillapp.com, no telemóvel, sem a app instalada: só se vê o ecrã de instalação (menos os termos e a privacidade). */
function Gate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  useInstall(); // volta a avaliar quando a app acaba de ser instalada
  if (installRequired() && !['/terms', '/privacy'].includes(pathname)) return <InstallGate />;
  return <>{children}</>;
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
  useEffect(() => {
    if (user) void syncPush();
  }, [user]);
  return user ? <ChatLive /> : null;
}

/** Só para quem já entrou. Sem sessão → login. */
/** Em admin.txillapp.com a página inicial é o backoffice (não o feed). */
function AdminHostRedirect({ children }: { children: ReactNode }) {
  return window.location.hostname.startsWith('admin.') ? <Navigate to="/backoffice" replace /> : <>{children}</>;
}

function Private({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const here = useLocation();
  if (loading) return <Splash />;
  // txillapp.com sem sessão mostra a apresentação; a app instalada vai direto ao login.
  // Em admin.txillapp.com não há apresentação pública: sem sessão vai ao login e depois ao backoffice.
  const onAdminHost = window.location.hostname.startsWith('admin.');
  if (!user && onAdminHost) return <Navigate to="/login" replace state={{ from: here.pathname === '/' ? '/backoffice' : here.pathname + here.search }} />;
  if (!user && here.pathname === '/' && !isStandalone()) return <Landing />;
  // Guarda para onde ia (ex.: um perfil partilhado) e volta lá depois de entrar.
  return user ? <>{children}</> : <Navigate to="/login" replace state={{ from: here.pathname + here.search }} />;
}

/** Links de posts e reels: com sessão abre normal; sem sessão mostra a pré-visualização pública (só leitura) em vez de pedir login. */
function PrivateOrPublic({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  return user ? <>{children}</> : <Suspense fallback={<Splash />}><PublicPost /></Suspense>;
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
        <TopLoader />
        <Live />
        <UpdateBanner />
        <SwipeClose />
        <BrowserRouter>
          <Gate>
          <Routes>
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
            <Route path="/google-username" element={<PublicOnly><GoogleUsername /></PublicOnly>} />
            <Route element={<Private><DesktopShell /></Private>}>
              {/* Páginas próprias em ecrã inteiro (como a Atividade do Instagram): sem a barra de baixo. */}
              <Route path="/notifications" element={<Private><Notifications /></Private>} />
              <Route path="/geleira" element={<Private><GeleiraEditor /></Private>} />
              <Route path="/v/:slug" element={<Private><Suspense fallback={<Splash />}><VenuePage /></Suspense></Private>} />
              <Route path="/locais" element={<Private><Suspense fallback={<Splash />}><Venues /></Suspense></Private>} />
              <Route path="/saved" element={<Private><Suspense fallback={<Splash />}><SavedPosts /></Suspense></Private>} />
              <Route path="/insights" element={<Private><Suspense fallback={<Splash />}><Insights /></Suspense></Private>} />
              <Route path="/settings" element={<Private><Settings /></Private>} />
              <Route path="/admin/stats" element={<Private><Suspense fallback={null}><AdminStats /></Suspense></Private>} />
              <Route path="/reels" element={<Private><Reels /></Private>} />
              <Route path="/reels/filtros" element={<Private><Suspense fallback={<Splash />}><ReelPrefs /></Suspense></Private>} />
              <Route path="/tag/:tag" element={<Private><TagPage /></Private>} />
              <Route path="/place/:name" element={<Private><Suspense fallback={<Splash />}><PlacePage /></Suspense></Private>} />
              <Route path="/admin/verifications" element={<Private><Suspense fallback={null}><AdminVerifications /></Suspense></Private>} />
              <Route path="/about" element={<Private><Suspense fallback={null}><SupportAbout /></Suspense></Private>} />
              <Route path="/backoffice" element={<Private><Suspense fallback={null}><BoLayout /></Suspense></Private>}>
                <Route index element={<Suspense fallback={null}><BoHome /></Suspense>} />
                <Route path="reports" element={<Suspense fallback={null}><BoReports /></Suspense>} />
                <Route path="users" element={<Suspense fallback={null}><BoUsers /></Suspense>} />
                <Route path="users/:id" element={<Suspense fallback={null}><BoUser /></Suspense>} />
                <Route path="audit" element={<Suspense fallback={null}><BoAudit /></Suspense>} />
                <Route path="team" element={<Suspense fallback={null}><BoTeam /></Suspense>} />
              </Route>
              <Route path="/invites" element={<Private><Suspense fallback={null}><Invites /></Suspense></Private>} />
              <Route path="/help" element={<Private><Suspense fallback={null}><SupportHelp /></Suspense></Private>} />
              <Route path="/orders" element={<Private><Suspense fallback={null}><SupportOrders /></Suspense></Private>} />
              <Route path="/language" element={<Private><Suspense fallback={null}><SupportLanguage /></Suspense></Private>} />
              <Route path="/verification" element={<Private><Suspense fallback={null}><Verification /></Suspense></Private>} />
              <Route path="/admin" element={<Private><Suspense fallback={null}><Admin /></Suspense></Private>} />
              <Route path="/r/:postId" element={<PrivateOrPublic><ReelPage /></PrivateOrPublic>} />
              <Route path="/p/:postId" element={<PrivateOrPublic><PostPage /></PrivateOrPublic>} />
              <Route path="/messages/g/:id" element={<Private><Thread /></Private>} />
              <Route path="/messages/:username" element={<Private><Thread /></Private>} />
              <Route path="/u/:username/connections" element={<Private><Connections /></Private>} />
              <Route
                element={
                  <Private>
                    <Layout />
                  </Private>
                }
              >
                <Route path="/" element={<AdminHostRedirect><Feed /></AdminHostRedirect>} />
                <Route path="/new" element={<CameraStudio />} />
                <Route path="/new/post" element={<Compose />} />
                <Route path="/wallet" element={<Wallet />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/u/:username" element={<Profile />} />
                <Route path="/search" element={<Search />} />
                <Route path="/messages" element={<Messages />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Gate>
          <Install />
          <Analytics />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
