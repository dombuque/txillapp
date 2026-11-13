import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { parseTurnstileMessage, turnstileHtml } from '@/lib/humanCheck';
import { useSiteKey } from '@/lib/turnstileKey';
import { colors } from '@/lib/theme';

// O tipo do WebView 14 com P = undefined dá props "never" no TS estrito: fixa-se P = {} (como no mapa).
const WV = WebView<{}>;

/** Sem resposta neste tempo, segue sem código (o servidor decide). Se a Cloudflare pedir para tocar, espera mais. */
const WAIT_MS = 20_000;
const WAIT_INTERACTIVE_MS = 120_000;

export interface HumanCheck {
  /** Põe isto no ecrã (fora do ScrollView): fica invisível e só aparece se a Cloudflare pedir para tocar. */
  node: ReactElement | null;
  /** Um código novo (de uso único) da prova de humano, ou undefined (prova desligada, sem rede, falhou). Nunca lança. */
  getToken: () => Promise<string | undefined>;
}

/**
 * Prova de humano (Cloudflare Turnstile) na app nativa: uma WebView pequena e escondida com o widget, aberta como se fosse
 * txillapp.com (o domínio autorizado na Cloudflare). Só nasce na primeira vez que se pede um código. Sem a chave do site
 * (EXPO_PUBLIC_TURNSTILE_SITEKEY) não faz nada. Ver lib/humanCheck.ts.
 */
export function useHumanCheck(): HumanCheck {
  const SITE_KEY = useSiteKey();
  const [mounted, setMounted] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const web = useRef<WebView<{}>>(null);
  const ready = useRef(false);
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
      setMounted(true);
      if (ready.current) web.current?.injectJavaScript('window.txRun && window.txRun();true;');
    });
  }, [wait, SITE_KEY]);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = parseTurnstileMessage(e.nativeEvent.data);
    if (!m) return;
    if (m.type === 'ready') {
      ready.current = true;
      if (pending.current) web.current?.injectJavaScript('window.txRun && window.txRun();true;');
    } else if (m.type === 'token') finish(m.token);
    else if (m.type === 'error') finish(undefined);
    else if (m.type === 'interactive') {
      setInteractive(true);
      wait(WAIT_INTERACTIVE_MS);
    } else if (m.type === 'done') setInteractive(false);
  };

  const node =
    SITE_KEY && mounted ? (
      <View style={interactive ? st.overlay : st.hidden} pointerEvents={interactive ? 'auto' : 'none'} accessibilityElementsHidden={!interactive}>
        <View style={interactive ? st.card : st.hiddenCard}>
          {interactive ? <Text style={st.title}>Confirma que és uma pessoa</Text> : null}
          <WV
            ref={web}
            source={{ html: turnstileHtml(SITE_KEY), baseUrl: 'https://txillapp.com' }}
            originWhitelist={['*']}
            onMessage={onMessage}
            onError={() => finish(undefined)}
            onContentProcessDidTerminate={() => { ready.current = false; finish(undefined); web.current?.reload(); }}
            onRenderProcessGone={() => { ready.current = false; finish(undefined); web.current?.reload(); }}
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
            geolocationEnabled={false}
            allowsLinkPreview={false}
            scrollEnabled={false}
            style={{ width: 300, height: 70, backgroundColor: 'transparent' }}
          />
        </View>
      </View>
    ) : null;

  return { node, getToken };
}

const st = StyleSheet.create({
  // Escondida mas viva (uma WebView sem tamanho nenhum pode não correr o JavaScript no Android).
  hidden: { position: 'absolute', left: 0, bottom: 0, width: 2, height: 2, opacity: 0, overflow: 'hidden' },
  hiddenCard: { width: 300, height: 70 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  card: { width: 332, borderRadius: 20, backgroundColor: colors.white, paddingVertical: 16, alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
});
