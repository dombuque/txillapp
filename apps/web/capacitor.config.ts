import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Txillapp para Android (e mais tarde iOS). A app nativa abre o Txillapp em produção dentro de um WebView:
 * as atualizações chegam sem passar pela loja, e a sessão (cookie) e a API são as mesmas da web.
 */
const config: CapacitorConfig = {
  appId: 'com.txillapp.app',
  appName: 'Txillapp',
  webDir: 'dist',
  server: {
    url: 'https://txillapp.com',
    androidScheme: 'https',
    allowNavigation: ['txillapp.com', '*.txillapp.com'],
  },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#ffffff' },
  },
};

export default config;
