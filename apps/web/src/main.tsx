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
import { ComingSoon, Profile } from './pages/Simple';
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
              <Route path="/favorites" element={<ComingSoon emoji="⭐" title="Favoritos a caminho" text="Vais poder guardar o que mais gostas. Calma, ainda estamos a aquecer 🔥" />} />
              <Route path="/messages" element={<ComingSoon emoji="✈️" title="Mensagens a caminho" text="Em breve podes cochichar com a malta 🤫" />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
