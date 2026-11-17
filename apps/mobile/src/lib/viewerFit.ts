/**
 * Como o visor em ecrã inteiro (PhotoViewer) desenha cada item, agora que o vídeo ocupa o ecrã todo (o iPhone do dono,
 * 1.59.1: o vídeo em pé ficava numa caixa entre o «×  3/3» e a legenda, com margens pretas). Como nas tchekas e nos
 * mimos: o cabeçalho e a legenda flutuam por cima, com um degradê escuro. Contas puras, testadas em
 * tests/viewerFit.test.mjs.
 */

export type Fit = 'cover' | 'contain';
export type Size = { w: number; h: number };

/** Um vídeo é «em pé» (enche o ecrã do telemóvel) a partir desta proporção altura/largura (2:3; o 9:16 dá 1,78). */
export const TALL_MEDIA = 1.5;
/** E o ecrã também tem de estar em pé (telemóvel): num ecrã deitado (computador, tablet deitado) o vídeo fica inteiro. */
export const TALL_SCREEN = 1.3;

const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** O tamanho do item: o que vem com a publicação (width/height) ou, sem ele, o medido quando o vídeo carrega. */
export function mediaSize(
  item: { width?: number | null; height?: number | null } | null | undefined,
  natural?: Size | null,
): Size | null {
  if (item && ok(item.width) && ok(item.height)) return { w: item.width, h: item.height };
  if (natural && ok(natural.w) && ok(natural.h)) return { w: natural.w, h: natural.h };
  return null;
}

/**
 * Como o vídeo enche o ecrã do visor. Vídeo em pé (altura/largura ≥ 1,5) num ecrã em pé: `cover`, a preencher de cima
 * a baixo (corta um pouco dos lados, como no TikTok). Vídeo deitado ou quadrado, sem tamanho conhecido, ou num ecrã
 * deitado (computador): `contain`, inteiro e centrado no ecrã todo, sem cortes.
 */
export function viewerVideoFit(media: Size | null | undefined, screen: Size): Fit {
  if (!media || !ok(media.w) || !ok(media.h) || !ok(screen.w) || !ok(screen.h)) return 'contain';
  const tallMedia = media.h / media.w >= TALL_MEDIA;
  const tallScreen = screen.h / screen.w >= TALL_SCREEN;
  return tallMedia && tallScreen ? 'cover' : 'contain';
}

/** O pager ocupa o ecrã inteiro: cada página (foto ou vídeo) tem o tamanho do ecrã, por baixo do cabeçalho e da legenda. */
export function viewerPage(screen: Size): Size {
  return { w: Math.max(0, Math.round(screen.w)), h: Math.max(0, Math.round(screen.h)) };
}

/** A legenda no visor mostra no máximo estas linhas (com «mais» para ver o resto), para não tapar o vídeo. */
export const CAPTION_LINES = 3;
/** Margens da legenda: 16 à esquerda e 84 à direita (a fila de ações). */
export const CAPTION_SIDES = 16 + 84;
/** Largura média de um carácter a 15 px (a fonte da legenda). */
const CHAR_W = 7.6;

/**
 * A legenda passa das 3 linhas no ecrã de largura `screenW`? (Estimativa pelos caracteres: o RN na web não mede as
 * linhas.) Cada parágrafo conta as linhas que ocupa; as linhas em branco contam uma.
 */
export function captionTooLong(body: string | null | undefined, screenW: number, lines = CAPTION_LINES): boolean {
  const b = (body ?? '').trim();
  if (!b) return false;
  const per = Math.max(12, Math.floor((Math.max(0, screenW) - CAPTION_SIDES) / CHAR_W));
  let total = 0;
  for (const p of b.split('\n')) {
    total += Math.max(1, Math.ceil(p.length / per));
    if (total > lines) return true;
  }
  return false;
}
