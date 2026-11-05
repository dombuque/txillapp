import { Capacitor } from '@capacitor/core';

/** Dentro da app Android (e, mais tarde, iOS). No browser e na PWA é sempre falso. */
export const isNative = () => Capacitor.isNativePlatform();

const ROOTS = new Set(['/', '/search', '/wallet', '/messages', '/profile', '/login', '/register', '/reels']);
let started = false;

/**
 * Liga o comportamento de app a sério: barra de estado, botão voltar do Android, ligações que abrem a app,
 * sem seleção de texto nem zoom de página, e o ecrã de abertura só desaparece quando a app está pronta.
 */
export async function initNative(navigate: (path: string) => void) {
  if (!isNative() || started) return;
  started = true;
  document.documentElement.classList.add('native');
  const viewport = document.querySelector('meta[name=viewport]');
  viewport?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#ffffff' });
  } catch { /* sem barra de estado configurável */ }

  try {
    const { App } = await import('@capacitor/app');
    // Botão voltar: fecha o que está aberto (janelas e ecrãs); nos ecrãs principais fecha a app, como as apps nativas.
    await App.addListener('backButton', () => {
      const path = window.location.pathname;
      if (ROOTS.has(path) || window.history.length <= 1) void App.minimizeApp();
      else window.history.back();
    });
    // Ligações txillapp.com/... abrem dentro da app.
    await App.addListener('appUrlOpen', (e) => {
      try {
        const u = new URL(e.url);
        if (u.hostname === 'txillapp.com' || u.hostname.endsWith('.txillapp.com')) navigate(u.pathname + u.search + u.hash);
      } catch { /* ligação inválida */ }
    });
  } catch { /* sem plugin */ }
}

/** Esconde o ecrã de abertura (chamar quando a app já desenhou o primeiro ecrã). */
export async function hideSplash() {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch { /* nada a esconder */ }
}
