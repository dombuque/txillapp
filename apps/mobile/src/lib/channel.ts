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

/**
 * Esta cópia pode procurar e sugerir versões novas por fora da loja (o aviso de atualização do APK)?
 * Só o APK beta do site. Numa app do Google Play ou da App Store as atualizações são só da loja: descarregar ou sugerir
 * um APK por fora é proibido (Play: Device and Network Abuse; Apple: 2.5.2).
 */
export function selfUpdates(channel: Channel): boolean {
  return channel === 'beta';
}

/** Como o canal aparece em Definições → Ajuda → Versão (para confirmar que o .aab do Play foi feito com EXPO_PUBLIC_CHANNEL=play). */
export function channelLabel(channel: Channel): string | null {
  return channel === 'play' ? 'Google Play' : channel === 'appstore' ? 'App Store' : channel === 'beta' ? 'beta' : null;
}
