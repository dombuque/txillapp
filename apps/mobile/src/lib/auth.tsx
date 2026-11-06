import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, refreshSession, refreshStore, setSessionExpiredHandler, type AuthResult, type PublicUser } from './api';

interface AuthState {
  user: PublicUser | null;
  /** A abrir a app: ainda a verificar se há sessão guardada. */
  loading: boolean;
  /** Sem rede ao abrir: a app tenta outra vez em vez de pedir login. */
  offline: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (b: Parameters<typeof api.register>[0]) => Promise<void>;
  /** Entra com uma sessão já obtida (ex.: depois do login com Google). */
  signInWith: (r: AuthResult) => void;
  signOut: () => Promise<void>;
  retry: () => void;
}

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      qc.clear();
    });
    return () => setSessionExpiredHandler(null);
  }, [qc]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setOffline(false);
      if (!(await refreshStore.get())) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const r = await refreshSession();
        if (!cancelled) setUser(r.user);
      } catch (e) {
        // 401: sessão terminada (já tratado). Qualquer outro erro é rede: não desloga.
        if (!cancelled && !(e instanceof ApiError && e.status === 401)) setOffline(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const r = await api.login(identifier, password);
    setUser(r.user);
  }, []);

  const signUp = useCallback(async (b: Parameters<typeof api.register>[0]) => {
    const r = await api.register(b);
    setUser(r.user);
  }, []);

  const signInWith = useCallback((r: AuthResult) => setUser(r.user), []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
    qc.clear(); // a próxima pessoa não vê dados da anterior
  }, [qc]);

  const value = useMemo<AuthState>(() => ({ user, loading, offline, signIn, signUp, signInWith, signOut, retry: () => setAttempt((n) => n + 1) }), [user, loading, offline, signIn, signUp, signInWith, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
