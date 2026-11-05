import type { CapacitorConfig } from '@capacitor/cli';

/** Txillapp para Android (e mais tarde iOS): a app leva dentro os ficheiros do Txillapp. */
const config: CapacitorConfig = {
  appId: 'com.txillapp.app',
  appName: 'Txillapp',
  webDir: 'dist',
  // Os ficheiros da app vão dentro do APK (abre logo, sem esperar pela rede) e usam o endereço txillapp.com:
  // a API é a mesma de sempre (os pedidos a /api saem para a rede, ver MainActivity), por isso as sessões e as ligações funcionam como no site.
  server: {
    hostname: 'txillapp.com',
    androidScheme: 'https',
    allowNavigation: ['txillapp.com'],
  },
  appendUserAgent: 'TxillappAndroid',
  backgroundColor: '#ffffff',
  android: { allowMixedContent: false, backgroundColor: '#ffffff' },
  plugins: {
    SplashScreen: { launchShowDuration: 0, launchAutoHide: false, backgroundColor: '#ffffff', androidScaleType: 'CENTER_INSIDE' },
    StatusBar: { overlaysWebView: false, style: 'DARK', backgroundColor: '#ffffff' },
  },
};

export default config;
