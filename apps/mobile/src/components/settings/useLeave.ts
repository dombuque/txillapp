import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { isStandaloneWeb } from '@/components/Landing';
import { useAuth } from '@/lib/auth';
import { afterSignOutRoute } from '@/lib/signOutRoute';

/**
 * Terminar sessão a partir das Definições (e depois de eliminar a conta): sai e vai logo para o destino certo
 * (lib/signOutRoute). Antes ia sempre para /login, mesmo quando a app passava para outra conta guardada (o ecrã de
 * entrar piscava e voltava ao Início) e, no browser, em vez da página de apresentação.
 */
export function useLeave() {
  const { signOut } = useAuth();
  const router = useRouter();
  return useCallback(async () => {
    const switched = await signOut();
    router.replace(afterSignOutRoute(switched, Platform.OS === 'web', isStandaloneWeb()) as never);
  }, [signOut, router]);
}
