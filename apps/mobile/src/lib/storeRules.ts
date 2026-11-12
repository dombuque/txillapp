import type { Channel } from './channel';

/**
 * Regras que mudam com a loja (App Store Review Guidelines e Google Play). Funções puras, sem React Native, para se
 * poderem testar: quem as usa passa o canal (CHANNEL, de lib/distribution) e, quando importa, o sistema.
 * Ver docs/lojas/app-store.md.
 */

/** Passos do «Prepara o Txillapp» depois de entrar pela primeira vez. */
export type OnboardingStep = 'notif' | 'camera' | 'photos' | 'location';

/**
 * App Store (5.1.1(iv) e Human Interface Guidelines): a câmara, as fotos e a localização pedem-se só quando a pessoa usa a
 * funcionalidade (cada ecrã já faz o pedido no sítio certo). No arranque fica só o das notificações, com explicação.
 */
export function onboardingSteps(channel: Channel): OnboardingStep[] {
  return channel === 'appstore' ? ['notif'] : ['notif', 'camera', 'photos', 'location'];
}

/**
 * O ecrã que explica uma permissão antes do pedido do sistema. Na App Store o botão diz «Continuar» (não «Permitir») e
 * não há «Agora não»: quem decide é a pessoa, no pedido do sistema, que tem sempre «Não permitir».
 */
export function prePromptButtons(channel: Channel): { primary: string; later: string | null } {
  return channel === 'appstore' ? { primary: 'Continuar', later: null } : { primary: 'Permitir', later: 'Agora não' };
}

/** Botão de um ecrã sem licença que leva ao pedido do sistema (câmara, galeria…). No iPhone: «Continuar». */
export const askButtonLabel = (os: string, other: string): string => (os === 'ios' ? 'Continuar' : other);

/**
 * «Entrar com Google». Regra 4.8 da App Store: com um login de terceiros no iPhone tem de haver também o Iniciar sessão
 * com a Apple (ou equivalente). Enquanto não houver, a versão da App Store não mostra o Google. Hoje o botão só existe
 * na web (o site e o PWA, que não passam pela App Store).
 */
export const googleSignInAllowed = (os: string, channel: Channel): boolean => os === 'web' && channel !== 'appstore';

/** Na versão das lojas não se mostram funcionalidades «em breve» (App Store 2.1/2.2, Google Play: funcionalidade mínima). */
export const showComingSoon = (channel: Channel): boolean => channel !== 'play' && channel !== 'appstore';
