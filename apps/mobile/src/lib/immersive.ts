import { Platform } from 'react-native';

/**
 * Modo imersivo (Tcheka): na web do iPhone a página passa a ocupar o ecrã todo, incluindo a zona do relógio,
 * da rede e da bateria (viewport-fit=cover + cor do sistema a preto). Nos outros ecrãs volta ao normal
 * (sem viewport-fit=cover, para não aparecer o desfoque no topo).
 */
let count = 0;
function apply(on: boolean) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const vp = document.querySelector('meta[name="viewport"]');
  const base = 'width=device-width, initial-scale=1, maximum-scale=1, interactive-widget=resizes-content';
  vp?.setAttribute('content', on ? `${base}, viewport-fit=cover` : base);
  let theme = document.querySelector('meta[name="theme-color"]');
  if (!theme) {
    theme = document.createElement('meta');
    theme.setAttribute('name', 'theme-color');
    document.head.appendChild(theme);
  }
  theme.setAttribute('content', on ? '#000000' : '#ffffff');
  document.documentElement.style.background = on ? '#000' : '#fff';
  document.body.style.background = on ? '#000' : '#fff';
}
export function enterImmersive() {
  count += 1;
  apply(true);
}
export function leaveImmersive() {
  count = Math.max(0, count - 1);
  if (count === 0) apply(false);
}
