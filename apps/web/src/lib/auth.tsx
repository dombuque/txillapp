import type { AuthResponse, PublicUser } from '@txillapp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, setAccessToken, setSessionExpiredHandler } from './api';

interface AuthCtx {
  user: PublicUser | null;
  /** A confirmar a sessão ao abrir a app. */
  loading: boolean;
  /** Sem rede/servidor: a tentar outra vez, sem mandar ninguém para o login. */
  reconnecting: boolean;
  signIn: (r: AuthResponse) => void;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const qc = useQueryClient();

  const signIn = useCallback((r: AuthResponse) => {
    setAccessToken(r.accessToken);
    setUser(r.user);
  }, []);

  useEffect(() => {
    // Só um 401 definitivo (sessão revogada ou terminada com logout) leva ao login.
    setSessionExpiredHandler(() => {
      setUser(null);
      qc.clear();
    });
    let cancelled = false;
    (async () => {
      for (let attempt = 0; !cancelled; attempt++) {
        try {
          signIn(await api.refresh());
          break;
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) break; // sem sessão guardada
          setReconnecting(true); // rede em baixo, 429, 5xx…: a sessão continua válida, tenta de novo
          await sleep(Math.min(1000 * 2 ** attempt, 15_000));
        }
      }
      if (!cancelled) {
        setReconnecting(false);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, [signIn, qc]);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    qc.clear(); // a próxima pessoa não vê dados da anterior
  }, [qc]);

  return <Ctx.Provider value={{ user, loading, reconnecting, signIn, signOut }}>{children}</Ctx.Provider>;
}
