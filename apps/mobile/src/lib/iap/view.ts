import type { IapCatalog, IapChannel, IapPlatform } from './core';

/**
 * Textos e estados dos ecrãs das compras pela loja (o selo azul e o Bombar), sem React Native, para os testes
 * (tests/iap.test.mjs). A Apple (3.1.2) exige à vista, antes de subscrever: o que se recebe, o preço e o período, que
 * renova sozinha, como se cancela, e as ligações para os Termos e a Privacidade.
 */

export const TERMS_URL = 'https://txillapp.com/termos';
export const PRIVACY_URL = 'https://txillapp.com/privacidade';

export const storeName = (platform: IapPlatform) => (platform === 'ios' ? 'App Store' : 'Google Play');

/** «por mês» / «por ano». */
export const periodLabel = (period: 'month' | 'year') => (period === 'year' ? 'por ano' : 'por mês');
/** «Mensal» / «Anual». */
export const periodTitle = (period: 'month' | 'year') => (period === 'year' ? 'Anual' : 'Mensal');

/** O que o selo azul dá. */
export const BLUE_BENEFITS: readonly string[] = [
  'O selo azul junto ao teu nome em todo o Txillapp: perfil, publicações, comentários, mensagens e mimos.',
  'Quem te encontra sabe que a conta é mesmo tua: a verificação continua a passar pela moderação.',
  'O selo vai também na assinatura das fotos e vídeos que guardas.',
];

/** As condições da subscrição, sempre à vista no ecrã (antes do botão Subscrever). */
export function subscriptionTerms(platform: IapPlatform): string[] {
  const store = storeName(platform);
  return [
    `O pagamento é cobrado na tua conta da ${store} quando confirmas a compra.`,
    'A subscrição renova-se automaticamente no fim de cada período, ao mesmo preço, a não ser que a canceles pelo menos 24 horas antes do fim.',
    platform === 'ios'
      ? 'Cancelas quando quiseres em Definições do iPhone, o teu nome, Subscrições (ou aqui, em «Gerir subscrição»). O selo fica até ao fim do período já pago.'
      : 'Cancelas quando quiseres na Google Play, Pagamentos e subscrições, Subscrições (ou aqui, em «Gerir subscrição»). O selo fica até ao fim do período já pago.',
  ];
}

/** «Ativo até 12/12/2026», e se não renova, diz que acaba. */
export function activeText(active: { expiresAt: string; autoRenew: boolean }): string {
  const d = new Date(active.expiresAt);
  const when = Number.isNaN(d.getTime()) ? active.expiresAt : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return active.autoRenew ? `O teu selo azul está ativo e renova a ${when}.` : `O teu selo azul está ativo até ${when}. Não vai renovar.`;
}

export type BlueScreenState = 'hidden' | 'loading' | 'not-eligible' | 'active' | 'offer';

/** O que o ecrã do selo azul mostra: só nas lojas, com o catálogo ligado no servidor. */
export function blueScreenState(channel: IapChannel, catalog: IapCatalog | null | undefined, loading = false): BlueScreenState {
  if (channel !== 'appstore' && channel !== 'play') return 'hidden';
  if (!catalog) return loading ? 'loading' : 'hidden';
  if (!catalog.enabled) return catalog.verification.active ? 'active' : 'hidden';
  if (catalog.verification.active) return 'active';
  if (!catalog.verification.eligible) return 'not-eligible';
  return 'offer';
}

/** O pacote do Bombar na API ('1d', '3d', '7d') a partir dos dias do produto da loja. */
export function boostPackageFor(days: number): '1d' | '3d' | '7d' {
  return days >= 7 ? '7d' : days >= 3 ? '3d' : '1d';
}

/** «3 dias · 5 km». */
export function boostPackLabel(p: { days: number; radiusKm: number }): string {
  return `${p.days} ${p.days === 1 ? 'dia' : 'dias'} · ${p.radiusKm} km`;
}
