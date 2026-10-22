import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { Login, Register } from './pages/AuthForm';
import Compose from './pages/Compose';
import Feed from './pages/Feed';
import { ComingSoon, Profile } from './pages/Simple';
import Wallet from './pages/Wallet';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

function Private({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-zinc-400">A carregar a vibe…</p>;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
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
