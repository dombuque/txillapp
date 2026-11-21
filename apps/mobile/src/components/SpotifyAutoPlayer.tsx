import { createElement, useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { spotifyUri } from '@/lib/musicLink';

/**
 * O leitor compacto do Spotify (o oficial, visível, como os termos deles pedem) que toca sozinho quando o mimo abre e
 * pára quando o mimo pausa ou passa. Na app (WebView) usa a API do iframe do Spotify (`controller.play()`), sem precisar
 * de um toque; sem sessão no Spotify toca o excerto de 30 s. No site o browser não deixa tocar sem toque: fica o leitor
 * compacto e o ▶ dele.
 */
export function SpotifyAutoPlayer({ link, embedUrl, paused, width }: { link: string; embedUrl: string; paused: boolean; width: number }) {
  const uri = spotifyUri(link);
  const ref = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  useEffect(() => {
    ref.current?.injectJavaScript(paused ? 'window.tx && window.tx.pause(); true;' : 'window.tx && window.tx.resume(); true;');
  }, [paused]);
  const h = 80;
  if (!uri) return null;
  if (Platform.OS === 'web') {
    return createElement('iframe', { src: `${embedUrl}?utm_source=txillapp`, width, height: h, style: { border: 0, borderRadius: 12 }, allow: 'autoplay; clipboard-write; encrypted-media', title: 'Spotify' });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview') as typeof import('react-native-webview');
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body><div id="e"></div>
<script src="https://open.spotify.com/embed/iframe-api/v1" async></script>
<script>
window.onSpotifyIframeApiReady=function(api){api.createController(document.getElementById('e'),{uri:${JSON.stringify(uri)},width:'100%',height:${h}},function(c){window.tx=c;c.addListener('ready',function(){c.play();});});};
</script></body></html>`;
  return (
    <View style={{ width, height: h, borderRadius: 12, overflow: 'hidden' }}>
      <WebView
        ref={ref as never}
        source={{ html, baseUrl: 'https://txillapp.com' }}
        style={{ width, height: h, backgroundColor: 'transparent' }}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        javaScriptEnabled
        scrollEnabled={false}
        originWhitelist={['https://*']}
        setSupportMultipleWindows={false}
      />
    </View>
  );
}
