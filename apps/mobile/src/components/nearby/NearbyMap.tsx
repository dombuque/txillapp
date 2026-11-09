import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { LEAFLET_CSS } from './leafletCss';
import { LEAFLET_JS, RUNTIME_JS } from './leafletInline';
import type { NearbyMapProps } from './types';

// O tipo do WebView 14 com P = undefined dá props "never" no TS estrito: fixa-se P = {}.
const WV = WebView<{}>;

const noClose = (s: string) => s.replace(/<\/(script|style)/gi, '<\\/$1');

/** A página do mapa (uma só vez): Leaflet e o mapRuntime vêm dentro da app, nada de CDN. Fala com a app por postMessage. */
const html = (zoomControl: boolean) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${noClose(LEAFLET_CSS)}
html,body,#m{margin:0;padding:0;height:100%;width:100%;background:#f2efe9;-webkit-tap-highlight-color:transparent}</style>
</head><body><div id="m"></div>
<script>${noClose(LEAFLET_JS)}</script>
<script>${noClose(RUNTIME_JS)}
(function(){
  function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var h = createNearbyMap(L, document.getElementById('m'), function(id){ post({ type: 'press', id: id }); }, { zoomControl: ${zoomControl ? 'true' : 'false'} });
  var first = true;
  window.txUpdate = function(s){ try { h.update(s); if (first) { first = false; setTimeout(function(){ h.resize(); }, 60); } } catch (e) { post({ type: 'error', message: String(e) }); } };
  window.addEventListener('resize', function(){ h.resize(); });
  post({ type: 'ready' });
})();
</script></body></html>`;
const PAGES: Partial<Record<'z' | 'n', string>> = {};
const page = (z: boolean) => (PAGES[z ? 'z' : 'n'] ??= html(z));

/** Mapa do "À tua volta" na app: uma WebView com o mesmo mapa do site (sem chaves pagas nem SDK de mapas). */
export function NearbyMap({ center, radiusKm, markers, onMarkerPress, selectedId, zoomControl = false, style }: NearbyMapProps) {
  const web = useRef<WebView<{}>>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const s = JSON.stringify({ center, radiusKm, markers, selectedId: selectedId ?? null });
    web.current?.injectJavaScript(`window.txUpdate && window.txUpdate(${s});true;`);
  }, [ready, center, radiusKm, markers, selectedId]);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { type?: string; id?: string; message?: string };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === 'ready') setReady(true);
    else if (m.type === 'press' && m.id) onMarkerPress(m.id);
    else if (m.type === 'error' && __DEV__) console.warn('[mapa]', m.message);
  };

  return (
    <View style={[{ flex: 1, backgroundColor: '#f2efe9', overflow: 'hidden' }, style]} accessibilityLabel="Mapa do que há à tua volta">
      <WV
        ref={web}
        source={{ html: page(zoomControl) }}
        originWhitelist={['*']}
        onMessage={onMessage}
        // A página recarrega se o sistema a matar (pouca memória): volta a pedir os marcadores.
        onContentProcessDidTerminate={() => { setReady(false); web.current?.reload(); }}
        onRenderProcessGone={() => { setReady(false); web.current?.reload(); }}
        // Ligações (a atribuição do mapa) abrem fora da app; a página em si fica.
        onShouldStartLoadWithRequest={(r) => {
          if (/^(about:|data:)/.test(r.url)) return true;
          void Linking.openURL(r.url);
          return false;
        }}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled={false}
        geolocationEnabled={false}
        allowsLinkPreview={false}
        bounces={false}
        overScrollMode="never"
        scrollEnabled={false}
        nestedScrollEnabled
        style={{ flex: 1, backgroundColor: 'transparent' }}
      />
    </View>
  );
}
