import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import { Wordmark } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { GoogleUsername, Login, Register } from './pages/AuthForm';
import Compose from './pages/Compose';
import Feed from './pages/Feed';
import Notifications from './pages/Notifications';
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

/** Só para quem já entrou. Sem sessão → login. */
function Private({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
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
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
            <Route path="/google-username" element={<PublicOnly><GoogleUsername /></PublicOnly>} />
            {/* Páginas próprias em ecrã inteiro (como a Atividade do Instagram): sem a barra de baixo. */}
            <Route path="/notifications" element={<Private><Notifications /></Private>} />
            <Route path="/settings" element={<Private><Settings /></Private>} />
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
              <Route path="/messages" element={<ComingSoon emoji="✈️" title="Mensagens a caminho" text="Em breve podes cochichar com a malta 🤫" />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
