/**
 * Fornecedores de música: o contrato que cada catálogo (licença aberta, artistas locais, música licenciada) cumpre.
 * Ver docs/musica.md (a faixa comum) e docs/musica-licenciada.md (como ligar um fornecedor comercial).
 */

/** A faixa comum a todos os catálogos (os campos de docs/musica.md). */
export interface MusicTrack {
  /** O id da faixa no catálogo de origem (único dentro de `source`). */
  id: string;
  title: string;
  artist: string;
  /** Duração em segundos (null se o catálogo não diz). */
  duration: number | null;
  /**
   * Endereço do excerto. Na música licenciada vem sempre a null nas listas: cada escuta tem de ser contada nos relatórios,
   * por isso o endereço (assinado e temporário) pede-se com POST /music/licensed/tracks/:id/listen.
   */
  previewUrl: string | null;
  cover: string | null;
  /** O catálogo de origem: 'openverse', 'artists', 'licensed'… */
  source: string;
  /** A licença: 'cc0', 'by', 'by-sa'… ou 'licensed' (contrato comercial com o fornecedor). */
  license: string;
  /** Estilos (marrabenta, amapiano, kizomba…), em minúsculas. */
  styles: string[];
  /** Quando o artista tem conta no Txillapp (programa de artistas locais). */
  artistUsername?: string | null;
}

/** O que se conta: a escuta no seletor, a reprodução numa publicação e a criação de uma publicação com a faixa. */
export type UsageEvent = 'preview' | 'play' | 'create';
export const USAGE_EVENTS: readonly UsageEvent[] = ['preview', 'play', 'create'];

/** Uma linha do relatório de uso: só números agregados (por dia, faixa, país e tipo), nunca quem ouviu. */
export interface UsageRow {
  /** O dia (UTC), AAAA-MM-DD. */
  day: string;
  trackId: string;
  /** ISO 3166 (alfa-2); 'ZZ' quando o país de quem usou não é conhecido. */
  country: string;
  event: UsageEvent;
  count: number;
}

/** Um aviso de remoção do fornecedor (a editora tirou a faixa, ou deixou de a licenciar). */
export interface TakedownNotice {
  trackId: string;
  reason: string;
  /** Quando o fornecedor emitiu o aviso (ISO 8601). */
  at: string;
}

export interface ProviderContext {
  /** O país de quem pede (ISO 3166 alfa-2, maiúsculas). */
  country: string;
}

/**
 * Um fornecedor de música comercial. Um adaptador por fornecedor (MassiveMusic/7digital, Feed.fm, Tuned Global, um acordo
 * direto com uma editora…): só traduz a API dele para isto. Os territórios do contrato, as remoções e os relatórios
 * agregados tratam-se em LicensedMusicService, iguais para todos.
 */
export interface MusicProvider {
  /** O nome curto (vai em `source` e nas tabelas): letras minúsculas, números, _ e -. */
  readonly source: string;
  search(q: string, ctx: ProviderContext & { limit: number }): Promise<MusicTrack[]>;
  /** O que está a dar no país (os tops do fornecedor). */
  trending(ctx: ProviderContext & { limit: number }): Promise<MusicTrack[]>;
  /** Uma faixa, ou null se não existe ou não está licenciada neste país. */
  track(id: string, ctx: ProviderContext): Promise<MusicTrack | null>;
  /** O endereço do excerto (assinado e temporário), ou null se a faixa não está disponível neste país. */
  previewUrl(id: string, ctx: ProviderContext & { maxSeconds: number }): Promise<{ url: string; expiresAt: string } | null>;
  /** Entrega o uso agregado (por faixa e por país). Devolve quantas linhas o fornecedor aceitou. */
  reportUsage(rows: UsageRow[]): Promise<{ accepted: number }>;
  /** Os avisos de remoção emitidos desde `since` (o fornecedor manda tirar faixas; nós tiramo-las de todo o lado). */
  takedowns(since: Date): Promise<TakedownNotice[]>;
}
