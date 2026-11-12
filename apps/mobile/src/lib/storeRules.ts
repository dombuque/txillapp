import type { Channel } from './channel';

/**
 * Regras que mudam com a loja (App Store Review Guidelines e Google Play). Funções puras, sem React Native, para se
 * poderem testar (tests/appStore.test.mjs e tests/storeRules.test.mjs): quem as usa passa o canal (CHANNEL, de
 * lib/distribution) e, quando importa, o sistema.
 * Ver docs/lojas/app-store.md e docs/lojas/pagamentos-e-ugc.md.
 */

/** Versão instalada a partir de uma loja (Google Play ou App Store). */
export const isStoreChannel = (channel: Channel) => channel === 'play' || channel === 'appstore';

// ---------------------------------------------------------------------------------------------------------------------
// Permissões, entrada e ecrãs (App Store)
// ---------------------------------------------------------------------------------------------------------------------

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
export const showComingSoon = (channel: Channel): boolean => !isStoreChannel(channel);

// ---------------------------------------------------------------------------------------------------------------------
// Compras (App Store 3.1.1 e 3.1.3; política de Pagamentos do Google Play)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * O que se pode comprar dentro desta cópia da app.
 *
 * Nas versões das lojas (Google Play e App Store) os bens e as funcionalidades DIGITAIS só se podem vender com a compra
 * dentro da app da própria loja. Ainda não temos essa compra ligada, por isso nessas versões não há nada que se compre
 * por fora nem botões ou textos que mandem comprar noutro sítio:
 *  • recarregar Txills (M-Pesa, e-Mola, cartão, teste) e o histórico desses pedidos;
 *  • pagar destaques do Bombar (publicidade dentro da app).
 * O que já se tem continua a usar-se: presentear com os Txills que já tens, receber Txills, pôr no cofre de um TxillGroup e
 * pagar nos locais (bens e serviços do mundo real). No site (web) e no APK beta não muda nada.
 *
 * O dono quer recarregar com M-Pesa/e-Mola/cartão (sem a compra das lojas). As lojas só o aceitam se os Txills forem dinheiro
 * entre pessoas (Apple 3.2.1(vii): presente opcional e 100% para quem recebe; Google: pagamento entre pessoas) e se nada
 * digital se pagar com eles. Hoje não são: não se levantam, os pacotes têm bónus e o Bombar paga-se com eles. Por isso a
 * recarga nas lojas tem dois interruptores, e os dois têm de estar ligados:
 *  • STORE_TOPUP_READY (esta versão da app já tem a carteira que cumpre as regras), hoje `false`;
 *  • `storeTopup` em GET /payments/config (PAYMENTS_STORE_TOPUP na API), para ligar e desligar sem versão nova.
 * O Bombar nunca se paga nas lojas. Ver docs/lojas/pagamentos-e-ugc.md.
 */
export interface PurchaseRules {
  /** Recarregar Txills com dinheiro e ver os pedidos de recarga (ecrã /orders). */
  buyTxills: boolean;
  /** Criar campanhas novas do Bombar (os destaques pagos). As que já existem veem-se e param-se sempre. */
  buyBoosts: boolean;
}

/**
 * Esta versão da app já tem a carteira que as lojas aceitam com pagamentos locais (levantar o saldo, 1 Txill = 1 MT, nada
 * digital pago com Txills; ver o documento). Enquanto for `false`, a recarga nunca aparece nas lojas, diga a API o que disser.
 */
export const STORE_TOPUP_READY = false;

/** O que vem do servidor (GET /payments/config). Sem resposta, conta como desligado. */
export interface RemotePurchaseFlags { storeTopup?: boolean }

export function purchaseRulesFor(channel: Channel, remote?: RemotePurchaseFlags | null, ready: boolean = STORE_TOPUP_READY): PurchaseRules {
  const store = isStoreChannel(channel);
  return { buyTxills: !store || (ready && remote?.storeTopup === true), buyBoosts: !store };
}

/** Opções das Definições que esta cópia não mostra (a pesquisa também não as propõe). */
export function hiddenSettingsFor(rules: PurchaseRules): string[] {
  return rules.buyTxills ? [] : ['orders'];
}

/** A linha do grupo «Txills e pagamentos» no início das Definições. */
export function paymentsSubtitleFor(rules: PurchaseRules, base: string): string {
  return rules.buyTxills ? base : 'Carteira e presentes';
}

/** Perguntas da Ajuda: sem compras, tira o que manda recarregar ou pagar o Bombar. */
export function helpFaqFor<T extends { q: string; a: string }>(rules: PurchaseRules, faq: readonly T[]): T[] {
  return faq
    .filter((f) => rules.buyBoosts || !/\bbombo\b|\bbombar\b/i.test(f.q))
    .map((f) => (rules.buyTxills ? f : { ...f, a: f.a.replace(/\s*Também podes recarregar[^.]*\./i, '').trim() }));
}
