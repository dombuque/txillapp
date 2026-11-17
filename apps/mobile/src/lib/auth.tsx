import { useQueryClient } from '@tanstack/react-query';
import { clearStudioDrafts } from '@/lib/studio/studioStore';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { api, migrateWebAccounts, refreshSession, refreshStore, setSessionExpiredHandler, type AuthResult, type PublicUser } from './api';
import { accounts } from './accounts';
import { SESSION_RECHECK_MS, offlineUserOf, sessionEnded } from './offlineSession';
import { forgetOutboxUser, setOutboxUser, startChatOutbox } from './chatOutbox';
import { leaveMapOnSignOut } from './api.nearby';
import { hangUp } from './calls/session';
import { unregisterNativePush } from './nativePush';

interface AuthState {
  user: PublicUser | null;
  /** A abrir a app: ainda a verificar se há sessão guardada. */
  loading: boolean;
  /** Sem rede ao abrir e sem conta guardada para abrir assim: a app tenta outra vez em vez de pedir login. */
  offline: boolean;
  /** Aberta sem rede com a conta da última vez (lib/offlineSession): confirma-se sozinha quando a rede voltar. */
  unconfirmed: boolean;
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
  /** Aberta sem rede com a conta da última vez (lib/offlineSession): a sessão ainda está por confirmar. */
  const [unconfirmed, setUnconfirmed] = useState(false);
  const userId = user?.id ?? null;
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = userId;

  // As mensagens que ficaram à espera de rede (lib/chatOutbox) são desta conta: carregam e enviam-se sozinhas.
  useEffect(() => {
    startChatOutbox();
    setOutboxUser(userId);
  }, [userId]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setUnconfirmed(false);
      qc.clear();
    });
    return () => setSessionExpiredHandler(null);
  }, [qc]);

  // Aberta sem rede com a conta da última vez: volta a confirmar a sessão quando a rede voltar, ao voltar ao primeiro
  // plano e de 15 em 15 s (só com a app à frente). Um 401 termina a sessão (o handler acima); rede: tenta outra vez.
  useEffect(() => {
    if (!unconfirmed) return;
    let alive = true;
    let busy = false;
    const check = async () => {
      if (busy || !alive || AppState.currentState === 'background') return;
      busy = true;
      try {
        const r = await refreshSession();
        if (!alive) return;
        setUser(r.user);
        setUnconfirmed(false);
        void qc.invalidateQueries();
        void migrateWebAccounts();
      } catch {
        /* rede: fica por confirmar (o 401 já terminou a sessão) */
      } finally {
        busy = false;
      }
    };
    const t = setInterval(() => void check(), SESSION_RECHECK_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
    const web = Platform.OS === 'web' && typeof window !== 'undefined';
    const onOnline = () => void check();
    if (web) window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      clearInterval(t);
      sub.remove();
      if (web) window.removeEventListener('online', onOnline);
    };
  }, [unconfirmed, qc]);

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
        if (!cancelled) { setUser(r.user); setUnconfirmed(false); }
        void migrateWebAccounts();
      } catch (e) {
        // 401: sessão terminada (já tratado). Qualquer outro erro é rede: não desloga. Abre com a conta da última vez
        // (lib/offlineSession), a confirmar quando a rede voltar; sem conta guardada com id, fica «Sem ligação».
        if (!cancelled && !sessionEnded(e)) {
          const cached = offlineUserOf(await accounts.current().catch(() => null));
          if (cancelled) return;
          if (cached) { setUser(cached); setUnconfirmed(true); } else setOffline(true);
        }
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
    setUnconfirmed(false);
    setUser(r.user);
  }, [qc]);

  const signUp = useCallback(async (b: Parameters<typeof api.register>[0], turnstileToken?: string) => {
    const r = await api.register(b, turnstileToken);
    accounts.endAdd();
    qc.clear();
    setUser(r.user);
  }, [qc]);

  const signInWith = useCallback((r: AuthResult) => { accounts.endAdd(); qc.clear(); setUnconfirmed(false); setUser(r.user); }, [qc]);

  const switchTo = useCallback(async (username: string) => {
    hangUp(); // a chamada era da outra conta (no Android o serviço da chamada pára com ela)
    await accounts.setCurrent(username);
    const r = await refreshSession();
    qc.clear();
    setUnconfirmed(false);
    setUser(r.user);
  }, [qc]);

  const signOut = useCallback(async (): Promise<boolean> => {
    hangUp(); // sair da conta desliga a chamada em curso (no Android o serviço da chamada pára com ela)
    // Ainda com sessão: deixo de aparecer à malta no mapa. Se falhar (sem rede), não prende a saída: a presença expira em 3 h.
    await leaveMapOnSignOut();
    await unregisterNativePush(); // este telemóvel deixa de receber as notificações desta conta
    await api.logout();
    // As mensagens à espera desta conta não ficam no aparelho nem se enviam depois.
    if (userIdRef.current) await forgetOutboxUser(userIdRef.current);
    setUnconfirmed(false);
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

  const value = useMemo<AuthState>(() => ({ user, loading, offline, unconfirmed, signIn, signUp, signInWith, signOut, switchTo, retry: () => setAttempt((n) => n + 1) }), [user, loading, offline, unconfirmed, signIn, signUp, signInWith, signOut, switchTo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
