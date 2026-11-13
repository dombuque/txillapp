import { useQueryClient } from '@tanstack/react-query';
import { clearStudioDrafts } from '@/lib/studio/studioStore';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, migrateWebAccounts, refreshSession, refreshStore, setSessionExpiredHandler, type AuthResult, type PublicUser } from './api';
import { accounts } from './accounts';
import { leaveMapOnSignOut } from './api.nearby';
import { hangUp } from './calls/session';
import { unregisterNativePush } from './nativePush';

interface AuthState {
  user: PublicUser | null;
  /** A abrir a app: ainda a verificar se há sessão guardada. */
  loading: boolean;
  /** Sem rede ao abrir: a app tenta outra vez em vez de pedir login. */
  offline: boolean;
  /** `turnstileToken`: a prova de humano (ver lib/humanCheck), quando há. */
  signIn: (identifier: string, password: string, turnstileToken?: string) => Promise<void>;
  signUp: (b: Parameters<typeof api.register>[0], turnstileToken?: string) => Promise<void>;
  /** Entra com uma sessão já obtida (ex.: depois do login com Google). */
  signInWith: (r: AuthResult) => void;
  /** Termina a sessão desta conta. Devolve `true` se passou para outra conta guardada neste aparelho. */
  signOut: () => Promise<boolean>;
  /** Muda para outra conta guardada neste aparelho. */
  switchTo: (username: string) => Promise<void>;
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
        void migrateWebAccounts();
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

  const signIn = useCallback(async (identifier: string, password: string, turnstileToken?: string) => {
    const r = await api.login(identifier, password, turnstileToken);
    accounts.endAdd();
    qc.clear();
    setUser(r.user);
  }, [qc]);

  const signUp = useCallback(async (b: Parameters<typeof api.register>[0], turnstileToken?: string) => {
    const r = await api.register(b, turnstileToken);
    accounts.endAdd();
    qc.clear();
    setUser(r.user);
  }, [qc]);

  const signInWith = useCallback((r: AuthResult) => { accounts.endAdd(); qc.clear(); setUser(r.user); }, [qc]);

  const switchTo = useCallback(async (username: string) => {
    hangUp(); // a chamada era da outra conta (no Android o serviço da chamada pára com ela)
    await accounts.setCurrent(username);
    const r = await refreshSession();
    qc.clear();
    setUser(r.user);
  }, [qc]);

  const signOut = useCallback(async (): Promise<boolean> => {
    hangUp(); // sair da conta desliga a chamada em curso (no Android o serviço da chamada pára com ela)
    // Ainda com sessão: deixo de aparecer à malta no mapa. Se falhar (sem rede), não prende a saída: a presença expira em 3 h.
    await leaveMapOnSignOut();
    await unregisterNativePush(); // este telemóvel deixa de receber as notificações desta conta
    await api.logout();
    qc.clear(); // a próxima pessoa não vê dados da anterior
    await clearStudioDrafts(); // e também não vê os rascunhos das tchekas (ficam no browser, sem conta)
    // Com mais contas no aparelho, sair desta passa para a seguinte.
    const rest = await accounts.list();
    if (rest[0]) {
      try {
        await accounts.setCurrent(rest[0].username);
        const r = await refreshSession();
        setUser(r.user);
        return true;
      } catch {
        /* a outra conta já não vale: vai para a entrada */
      }
    }
    setUser(null);
    return false;
  }, [qc]);

  const value = useMemo<AuthState>(() => ({ user, loading, offline, signIn, signUp, signInWith, signOut, switchTo, retry: () => setAttempt((n) => n + 1) }), [user, loading, offline, signIn, signUp, signInWith, signOut, switchTo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
