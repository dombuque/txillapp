import type { AuthResponse, PublicUser } from '@txillapp/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setAccessToken } from './api';

interface AuthCtx {
  user: PublicUser | null;
  loading: boolean;
  signIn: (r: AuthResponse) => void;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const signIn = useCallback((r: AuthResponse) => {
    setAccessToken(r.accessToken);
    setUser(r.user);
  }, []);

  useEffect(() => {
    api
      .refresh()
      .then(signIn)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [signIn]);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}
