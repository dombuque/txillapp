/**
 * O contrato comum de uma faixa de música no servidor (ver docs/musica.md). Todas as fontes (ccMixter, Internet Archive,
 * Jamendo, Freesound e a fonte `local` dos artistas de Moçambique) entregam faixas neste formato; o seletor da app e o
 * backoffice só conhecem este formato.
 */

/** As fontes que o catálogo conhece. `local` é a dos artistas de Moçambique (carregam as músicas no Txillapp). */
export const MUSIC_SOURCES = ['ccmixter', 'archive', 'jamendo', 'freesound', 'local'] as const;
export type MusicSourceId = (typeof MUSIC_SOURCES)[number];

/**
 * Licenças que servem para pôr música num mimo ou num tcheka partilhado:
 * - `cc0` e `pdm` (domínio público): sem condições;
 * - `by` (Creative Commons Atribuição): só pede o crédito, que vai sempre com a faixa;
 * - `txillapp`: o artista deu ao Txillapp a licença para usar a faixa nos mimos e nas tchekas (só a fonte `local`).
 * Fora: NC (não comercial: o Txillapp é uma app com compras), ND (sem derivados) e SA (partilha igual). Pôr uma música
 * num vídeo conta sempre como obra derivada nas licenças CC ("synched in timed relation with a moving image"), por isso
 * ND não deixa, e SA obrigaria o mimo inteiro a ficar em CC BY-SA.
 */
export const OPEN_LICENSES = ['cc0', 'pdm', 'by'] as const;
export const TRACK_LICENSES = [...OPEN_LICENSES, 'txillapp'] as const;
export type TrackLicense = (typeof TRACK_LICENSES)[number];

/** Estilos e momentos que a malta procura. A ordem é a das pastilhas no seletor. */
export const MUSIC_STYLES = [
  { id: 'afrobeats', label: 'Afrobeats', kind: 'estilo' },
  { id: 'amapiano', label: 'Amapiano', kind: 'estilo' },
  { id: 'pandza', label: 'Pandza', kind: 'estilo' },
  { id: 'marrabenta', label: 'Marrabenta', kind: 'estilo' },
  { id: 'kizomba', label: 'Kizomba e Zouk', kind: 'estilo' },
  { id: 'hiphop', label: 'Hip-hop e Trap', kind: 'estilo' },
  { id: 'rnb', label: 'R&B', kind: 'estilo' },
  { id: 'gospel', label: 'Gospel', kind: 'estilo' },
  { id: 'chill', label: 'Chill e Lo-fi', kind: 'estilo' },
  { id: 'festa', label: 'Festa', kind: 'momento' },
  { id: 'romantico', label: 'Romântico', kind: 'momento' },
  { id: 'praia', label: 'Praia', kind: 'momento' },
] as const;
export type MusicStyleId = (typeof MUSIC_STYLES)[number]['id'];
export const STYLE_IDS = MUSIC_STYLES.map((s) => s.id) as readonly MusicStyleId[];
export const isStyle = (v: unknown): v is MusicStyleId => typeof v === 'string' && (STYLE_IDS as readonly string[]).includes(v);

/** `music`: uma música para tocar por baixo; `sound`: um efeito ou som solto (risos, aplausos…), que vai para a secção «Sons». */
export type TrackKind = 'music' | 'sound';

/** Uma faixa, como todas as fontes a entregam. */
export interface CatalogTrack {
  /** `<fonte>:<id na fonte>`, até 80 caracteres (ex.: `ccmixter:16626`, `local:0190…`). */
  id: string;
  title: string;
  /** O nome artístico, para o crédito. */
  artist: string;
  /** Duração em segundos (inteiro). */
  duration: number;
  /** Endereço https do áudio que se ouve no seletor e toca no mimo/tcheka (mp3 ou m4a). */
  previewUrl: string;
  /** Capa (https) ou null. */
  cover: string | null;
  source: MusicSourceId;
  license: TrackLicense;
  /** Texto da licença (https) ou null (ex.: `txillapp`). */
  licenseUrl: string | null;
  /** Página original da faixa, para o crédito (https) ou null. */
  landing: string | null;
  styles: MusicStyleId[];
  kind: TrackKind;
  /** Só na fonte `local`: o @ do artista no Txillapp (sem o @), para o crédito levar ao perfil. */
  artistUsername?: string;
  /** Só na fonte `local`: letra explícita. Quem tem menos de 18 anos (ou não deu a data de nascimento) não a vê nem a usa. */
  explicit?: boolean;
}

/**
 * Uma fonte de faixas que a equipa dos artistas regista no catálogo (ver docs/musica.md). Só faixas já aprovadas e
 * publicadas; o catálogo trata da ordem, das rejeições («Não gosto desta») e do que o backoffice esconde.
 */
export interface LocalMusicSource {
  /** Faixas publicadas, as melhores primeiro. `style` filtra por estilo; `q` procura no título e no artista. */
  list(opts: { style?: MusicStyleId; q?: string; limit: number }): Promise<CatalogTrack[]>;
  /** Uma faixa pelo id (`local:…`), só se continuar publicada; senão null. */
  get(id: string): Promise<CatalogTrack | null>;
  /**
   * Usar a faixa num mimo (`story`) ou numa tcheka (`post`): confirma que continua disponível para quem a usa (as explícitas
   * não vão para menores), conta o uso e devolve o que fica guardado na publicação. Sem isto, as faixas locais não se usam.
   */
  prepareUse?(userId: string, id: string, surface: 'post' | 'story'): Promise<Record<string, unknown>>;
  /** Ao devolver uma publicação: o que ficou guardado volta a ter o endereço do áudio (assinado e temporário). */
  resolveStored?(stored: Record<string, unknown>): Record<string, unknown>;
}

/** O que a app recebe: a faixa do contrato com os nomes antigos (`url`, `durationMs`), para as versões antigas e para os posts. */
export interface PickerTrack extends CatalogTrack {
  url: string;
  durationMs: number;
  /** Vezes que foi usada em mimos e tchekas nos últimos 7 dias (só em «Em alta»). */
  uses?: number;
  /** Destacada pela equipa no backoffice. */
  featured?: boolean;
  /** Vezes que foi usada em mimos e tchekas desde sempre (o «1,2 mil usos» das linhas do seletor). */
  usesTotal?: number;
  /** As duas cores do gradiente do destaque, tiradas da capa (sem capa, ou sem as conseguir ler, não vem). */
  coverColors?: [string, string];
}

export const toPicker = (t: CatalogTrack, extra: { uses?: number; featured?: boolean; usesTotal?: number; coverColors?: [string, string] | null } = {}): PickerTrack => ({
  ...t,
  url: t.previewUrl,
  durationMs: t.duration * 1000,
  ...(extra.uses !== undefined ? { uses: extra.uses } : {}),
  ...(extra.featured ? { featured: true } : {}),
  ...(extra.usesTotal !== undefined ? { usesTotal: extra.usesTotal } : {}),
  ...(extra.coverColors ? { coverColors: extra.coverColors } : {}),
});

/** Limites de duração: fora disto não serve para um mimo ou um tcheka. */
export const MUSIC_MIN_S = 45;
export const MUSIC_MAX_S = 420;
export const SOUND_MIN_S = 1;
export const SOUND_MAX_S = 30;
