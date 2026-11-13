import { useEffect, useState } from 'react';
import { api } from './api';
import { turnstileSiteKey } from './humanCheck';

/** A chave do site posta na app ao compilar (EXPO_PUBLIC_TURNSTILE_SITEKEY), se houver. */
const BUILT = turnstileSiteKey(process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY);

let loading: Promise<string | null> | null = null;

/**
 * A chave do site do Turnstile: a da compilação ou, sem ela, a que o servidor diz em GET /auth/config
 * (`turnstileSiteKey`, da variável TURNSTILE_SITEKEY da API). Assim o site e as APKs já instaladas ligam a prova sem
 * compilar outra vez. Sem chave nenhuma, a prova fica desligada.
 */
export function siteKey(): Promise<string | null> {
  if (BUILT) return Promise.resolve(BUILT);
  return (loading ??= api
    .authConfig()
    .then((c) => turnstileSiteKey(c.turnstileSiteKey ?? undefined))
    .catch(() => {
      loading = null; // sem rede: tenta outra vez da próxima
      return null;
    }));
}

/** A chave para os componentes (null enquanto não se sabe ou se está desligada). */
export function useSiteKey(): string | null {
  const [key, setKey] = useState<string | null>(BUILT);
  useEffect(() => {
    if (BUILT) return;
    let on = true;
    void siteKey().then((k) => on && setKey(k));
    return () => {
      on = false;
    };
  }, []);
  return key;
}
