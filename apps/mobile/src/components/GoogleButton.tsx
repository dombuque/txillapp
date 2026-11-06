import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { createElement, useEffect, useRef } from 'react';
import { Platform, Text, View } from 'react-native';
import { ApiError, api, type GoogleNeedsUsername } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/** Dados do passo "escolher o @" depois do Google (não são sensíveis). Passam em memória entre ecrãs. */
let pending: GoogleNeedsUsername | null = null;
export const googleSignup = {
  get: () => pending,
  set: (v: GoogleNeedsUsername | null) => { pending = v; },
};

interface GoogleId {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: unknown, o: Record<string, unknown>) => void;
}
const gis = () => (globalThis as unknown as { google?: { accounts: { id: GoogleId } } }).google;

let gisLoading: Promise<void> | null = null;
function loadGoogleScript() {
  return (gisLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new Error('Não consegui carregar o login com Google'));
    };
    document.head.appendChild(s);
  }));
}

/** Botão oficial "Continuar com Google". Só na web e só se o servidor tiver o login com Google configurado. */
export function GoogleButton(props: { mode: 'login' | 'register'; onError: (m: string) => void }) {
  if (Platform.OS !== 'web') return null;
  return <WebGoogleButton {...props} />;
}

function WebGoogleButton({ mode, onError }: { mode: 'login' | 'register'; onError: (m: string) => void }) {
  const { signInWith } = useAuth();
  const router = useRouter();
  const holder = useRef<{ innerHTML: string; clientWidth: number } | null>(null);
  const { data } = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig, staleTime: Infinity, retry: 1 });
  const clientId = data?.googleClientId;

  useEffect(() => {
    if (!clientId || !holder.current) return;
    let alive = true;
    loadGoogleScript()
      .then(() => {
        const g = gis();
        const el = holder.current;
        if (!alive || !el || !g) return;
        g.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            try {
              const r = await api.googleLogin(credential);
              if ('needsUsername' in r) {
                googleSignup.set(r);
                return router.replace('/google-username' as never);
              }
              signInWith(r);
              router.replace('/');
            } catch (x) {
              onError(x instanceof ApiError ? x.message : 'Não consegui entrar com a Google');
            }
          },
        });
        el.innerHTML = '';
        g.accounts.id.renderButton(el, {
          type: 'standard', theme: 'outline', size: 'large', shape: 'pill',
          text: mode === 'login' ? 'continue_with' : 'signup_with', locale: 'pt-PT',
          width: Math.min(el.clientWidth || 320, 400),
        });
      })
      .catch((x: Error) => onError(x.message));
    return () => { alive = false; };
  }, [clientId, mode, router, signInWith, onError]);

  if (!clientId) return null;
  return (
    <View style={{ marginTop: 20 }}>
      <View style={{ marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityElementsHidden>
        <View style={{ height: 1, flex: 1, backgroundColor: colors.zinc300 }} />
        <Text style={{ fontSize: 14, color: colors.zinc600 }}>ou</Text>
        <View style={{ height: 1, flex: 1, backgroundColor: colors.zinc300 }} />
      </View>
      {createElement('div', { ref: holder, style: { display: 'flex', justifyContent: 'center', minHeight: 44 } })}
    </View>
  );
}
