import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { LEAFLET_CSS } from './leafletCss';
import { LEAFLET_JS, RUNTIME_JS } from './leafletInline';
import { PickPin } from './PickPin';
import type { PlacePickMapProps } from './types';

// Como no NearbyMap: P = {} para o TS estrito.
const WV = WebView<{}>;
const noClose = (s: string) => s.replace(/<\/(script|style)/gi, '<\\/$1');

/** A página do mapa de "Marcar no mapa" (uma só vez): Leaflet e o mapRuntime dentro da app; fala com a app por postMessage. */
let PAGE: string | null = null;
const page = () =>
  (PAGE ??= `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${noClose(LEAFLET_CSS)}
html,body,#m{margin:0;padding:0;height:100%;width:100%;background:#f2efe9;-webkit-tap-highlight-color:transparent}</style>
</head><body><div id="m"></div>
<script>${noClose(LEAFLET_JS)}</script>
<script>${noClose(RUNTIME_JS)}
(function(){
  function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var h = createPickMap(L, document.getElementById('m'), function(c){ post({ type: 'move', lat: c.lat, lng: c.lng }); }, { zoomControl: true });
  var first = true;
  window.txCenter = function(c){ try { h.setCenter(c); if (first) { first = false; setTimeout(function(){ h.resize(); }, 60); } } catch (e) { post({ type: 'error', message: String(e) }); } };
  window.addEventListener('resize', function(){ h.resize(); });
  post({ type: 'ready' });
})();
</script></body></html>`);

/** "Marcar no mapa" na app: o mesmo mapa do site numa WebView, com o alfinete fixo ao centro por cima. */
export function PlacePickMap({ center, onMove, style }: PlacePickMapProps) {
  const web = useRef<WebView<{}>>(null);
  const [ready, setReady] = useState(false);
  const move = useRef(onMove);
  move.current = onMove;

  useEffect(() => {
    if (!ready) return;
    web.current?.injectJavaScript(`window.txCenter && window.txCenter(${JSON.stringify({ lat: center.lat, lng: center.lng })});true;`);
  }, [ready, center]);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { type?: string; lat?: number; lng?: number; message?: string };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === 'ready') setReady(true);
    else if (m.type === 'move' && typeof m.lat === 'number' && typeof m.lng === 'number') move.current({ lat: m.lat, lng: m.lng });
    else if (m.type === 'error' && __DEV__) console.warn('[mapa]', m.message);
  };

  return (
    <View style={[{ backgroundColor: '#f2efe9', overflow: 'hidden' }, style]}>
      <WV
        ref={web}
        source={{ html: page() }}
        originWhitelist={['*']}
        onMessage={onMessage}
        onContentProcessDidTerminate={() => { setReady(false); web.current?.reload(); }}
        onRenderProcessGone={() => { setReady(false); web.current?.reload(); }}
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
      <PickPin />
    </View>
  );
}
