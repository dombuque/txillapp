import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSiteKey } from '@/lib/turnstileKey';
import { colors } from '@/lib/theme';
import type { HumanCheck } from './HumanCheck';

const WAIT_MS = 20_000;
const WAIT_INTERACTIVE_MS = 120_000;
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface Turnstile {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id: string) => void;
  execute: (id: string) => void;
}
const ts = () => (globalThis as { turnstile?: Turnstile }).turnstile;

/** O script da Cloudflare, uma só vez por página. Falha (rede, bloqueado) → null: segue-se sem prova. */
let loading: Promise<Turnstile | null> | null = null;
function loadScript(): Promise<Turnstile | null> {
  if (ts()) return Promise.resolve(ts()!);
  return (loading ??= new Promise<Turnstile | null>((resolve) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    const t = setTimeout(() => resolve(ts() ?? null), 10_000);
    s.onload = () => { clearTimeout(t); resolve(ts() ?? null); };
    s.onerror = () => { clearTimeout(t); loading = null; resolve(null); };
    document.head.appendChild(s);
  }));
}

/** Na web a ref de uma View é o próprio elemento do DOM. */
type El = HTMLElement | null;

/**
 * Prova de humano (Cloudflare Turnstile) no browser: o widget invisível («interaction-only») num contentor escondido, que
 * só aparece por cima do ecrã se a Cloudflare pedir para tocar. Cada código é de uso único: cada pedido faz reset.
 * Sem a chave do site (EXPO_PUBLIC_TURNSTILE_SITEKEY) não faz nada. Ver lib/humanCheck.ts.
 */
export function useHumanCheck(): HumanCheck {
  const SITE_KEY = useSiteKey();
  const [interactive, setInteractive] = useState(false);
  const box = useRef<El>(null);
  const widget = useRef<string | null>(null);
  const pending = useRef<((t: string | undefined) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback((t: string | undefined) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setInteractive(false);
    const p = pending.current;
    pending.current = null;
    p?.(t);
  }, []);
  const wait = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => finish(undefined), ms);
  }, [finish]);
  useEffect(() => () => finish(undefined), [finish]);

  const getToken = useCallback((): Promise<string | undefined> => {
    if (!SITE_KEY) return Promise.resolve(undefined);
    pending.current?.(undefined);
    return new Promise((resolve) => {
      pending.current = resolve;
      wait(WAIT_MS);
      void loadScript().then((t) => {
        if (pending.current !== resolve) return; // já acabou (tempo esgotado ou outro pedido)
        if (!t || !box.current) return finish(undefined);
        try {
          if (widget.current === null) {
            widget.current = t.render(box.current, {
              sitekey: SITE_KEY,
              appearance: 'interaction-only',
              execution: 'execute',
              language: 'pt',
              callback: (token: string) => finish(token),
              'error-callback': () => { finish(undefined); return true; },
              'before-interactive-callback': () => { setInteractive(true); wait(WAIT_INTERACTIVE_MS); },
              'after-interactive-callback': () => setInteractive(false),
            });
          } else t.reset(widget.current);
          t.execute(widget.current);
        } catch {
          finish(undefined);
        }
      });
    });
  }, [finish, wait, SITE_KEY]);

  const node = SITE_KEY ? (
    <View style={interactive ? st.overlay : st.hidden} pointerEvents={interactive ? 'auto' : 'none'} aria-hidden={!interactive}>
      <View style={interactive ? st.card : undefined}>
        {interactive ? <Text style={st.title}>Confirma que és uma pessoa</Text> : null}
        <View ref={(v) => { box.current = v as unknown as El; }} />
      </View>
    </View>
  ) : null;

  return { node, getToken };
}

const st = StyleSheet.create({
  hidden: { position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  overlay: { position: 'fixed' as 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  card: { minWidth: 332, borderRadius: 20, backgroundColor: colors.white, padding: 16, alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
});
