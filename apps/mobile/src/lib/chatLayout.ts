/**
 * Desenho das bolhas do chat (lógica pura, sem React, testada em tests/chatLayout.test.mjs):
 *  - cantos (20 por fora, 6 nos cantos interiores do lado de quem envia) e onde vai o avatar (na última bolha do grupo dela);
 *  - os vistos das minhas mensagens: "✓" (entregue) / "✓✓" (visto), por baixo da última bolha de cada grupo, com a hora.
 * Que bolhas se juntam e onde entram os separadores decide-o lib/chatTimeline (a única lógica de agrupamento).
 */

/** O que o desenho precisa de cada mensagem (a `Msg` do chat tem tudo isto). */
export interface LayoutMsg {
  id: string;
  fromMe: boolean;
  kind: string;
  at: string;
  state?: 'sending' | 'waiting' | 'failed';
  sender?: { username: string } | null;
}

export const RADIUS = 20;
export const INNER = 6;
/** Espaço entre bolhas do mesmo grupo e entre grupos. */
export const GAP_IN = 2;
export const GAP_OUT = 12;
/** Avatar da outra pessoa e o espaço até à bolha. */
export const AVATAR = 28;
export const AVATAR_GAP = 8;

export interface Corners { borderTopLeftRadius: number; borderTopRightRadius: number; borderBottomLeftRadius: number; borderBottomRightRadius: number }

/** Cantos da bolha: 20 por fora; do lado de quem envia, 6 em cima nas do meio/fim e 6 em baixo nas do início/meio. */
export function corners(mine: boolean, first: boolean, last: boolean): Corners {
  const top = first ? RADIUS : INNER;
  const bottom = last ? RADIUS : INNER;
  return mine
    ? { borderTopLeftRadius: RADIUS, borderBottomLeftRadius: RADIUS, borderTopRightRadius: top, borderBottomRightRadius: bottom }
    : { borderTopRightRadius: RADIUS, borderBottomRightRadius: RADIUS, borderTopLeftRadius: top, borderBottomLeftRadius: bottom };
}

/** O avatar da outra pessoa vai só na última bolha de cada grupo dela (nas outras fica o espaço). */
export const showAvatar = (mine: boolean, p: { last: boolean }) => !mine && p.last;

export type Ticks = 'seen' | 'sent';

/**
 * Os vistos das minhas mensagens: "✓" (entregue) ou "✓✓" (visto). `items` vem do mais recente para o mais antigo (como a
 * lista invertida); `seenId` é a minha última mensagem quando a outra pessoa já a leu (então todas as minhas anteriores
 * também estão vistas). Uma minha seguida de uma mensagem da outra pessoa também conta como vista (ela respondeu).
 * As que estão a enviar ou falharam ficam de fora (dizem isso elas próprias). Nos grupos não há vistos: mapa vazio.
 */
export function ticksFor(items: LayoutMsg[], seenId: string | null, group: boolean): Map<string, Ticks> {
  const out = new Map<string, Ticks>();
  if (group) return out;
  let seen = false;
  for (const m of items) {
    // Um aviso de sistema ("ligou as mensagens temporárias") não é resposta: não marca as minhas como vistas.
    if (m.kind === 'system') continue;
    if (!m.fromMe) {
      seen = true;
      continue;
    }
    if (m.id === seenId) seen = true;
    if (m.state || m.id.startsWith('tmp-')) continue;
    out.set(m.id, seen ? 'seen' : 'sent');
  }
  return out;
}

/** A bolha de foto (como no WhatsApp): a largura normal, a altura da proporção da foto, entre estes limites. */
export const PHOTO_W = 240;
export const PHOTO_MIN_W = 160;
export const PHOTO_MIN_H = 120;
export const PHOTO_MAX_H = 320;
/** Enquanto a foto não carrega (não se sabe a forma): a caixa de sempre. */
export const PHOTO_WAIT_H = 288;

/**
 * O tamanho da bolha de uma foto com a proporção `ratio` (largura/altura): a foto aparece inteira (contain) e a caixa tem a
 * forma dela. Uma foto alta fica mais estreita (até PHOTO_MIN_W) com a altura máxima; uma muito deitada fica com a altura
 * mínima, com uma faixa por cima e por baixo. Sem proporção, a caixa de espera.
 */
export function photoBubbleSize(ratio: number | null | undefined): { width: number; height: number } {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return { width: PHOTO_W, height: PHOTO_WAIT_H };
  const h = PHOTO_W / ratio;
  if (h > PHOTO_MAX_H) return { width: Math.round(Math.max(PHOTO_MIN_W, PHOTO_MAX_H * ratio)), height: PHOTO_MAX_H };
  return { width: PHOTO_W, height: Math.round(Math.max(PHOTO_MIN_H, h)) };
}
