/**
 * Por onde esta cópia da app chegou à pessoa:
 * - 'beta': o APK do site (txillapp.com/app/beta), com o aviso de atualização próprio;
 * - 'play': Google Play (as atualizações são da loja);
 * - 'appstore': App Store;
 * - 'web': o site / PWA.
 * Vem de EXPO_PUBLIC_CHANNEL no build (ex.: EXPO_PUBLIC_CHANNEL=play). Sem ele: iPhone = 'appstore', Android = 'beta'.
 */
export type Channel = 'beta' | 'play' | 'appstore' | 'web';

export function channelFor(os: string, env: string | undefined): Channel {
  if (os === 'web') return 'web';
  const e = String(env ?? '').trim().toLowerCase();
  if (e === 'play' || e === 'appstore' || e === 'beta') return e;
  return os === 'ios' ? 'appstore' : 'beta';
}
