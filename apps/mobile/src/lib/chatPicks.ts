/**
 * Fotos e vídeos escolhidos da galeria para enviar numa conversa (privada ou de grupo). Dá para escolher vários de uma
 * vez (até CHAT_PICK_MAX, pela ordem em que se tocaram); cada um vai como uma mensagem, pela mesma ordem, e a legenda
 * escrita na caixa vai só com o primeiro.
 */
export const CHAT_PICK_MAX = 10;

export type ChatPick = { uri: string; mime: string; video: boolean };

type Asset = { uri?: string | null; type?: string | null; mimeType?: string | null };

/** Os escolhidos que dá para enviar (com uri, foto ou vídeo), no máximo `max`. */
export function chatPicks(assets: readonly Asset[] | null | undefined, max = CHAT_PICK_MAX): ChatPick[] {
  const out: ChatPick[] = [];
  for (const a of assets ?? []) {
    if (!a || typeof a.uri !== 'string' || !a.uri) continue;
    const mime = typeof a.mimeType === 'string' ? a.mimeType : '';
    const video = a.type === 'video' || mime.startsWith('video/');
    const image = a.type === 'image' || a.type === 'livePhoto' || a.type === 'pairedVideo' || mime.startsWith('image/');
    if (!video && !image && a.type) continue;
    out.push({ uri: a.uri, mime: mime || (video ? 'video/mp4' : 'image/jpeg'), video });
    if (out.length >= max) break;
  }
  return out;
}

/** O aviso enquanto se enviam: «A enviar…» com um, «A enviar 2 de 5…» com vários. */
export function sendingLabel(done: number, total: number): string {
  if (total <= 1) return 'A enviar…';
  return `A enviar ${Math.min(done + 1, total)} de ${total}…`;
}

/** O erro no fim, se algum não foi. */
export function failedLabel(failed: number, total: number): string {
  if (failed <= 0) return '';
  if (total <= 1) return 'Não consegui enviar';
  return failed === total ? 'Não consegui enviar nenhum' : failed === 1 ? `Não consegui enviar 1 de ${total}` : `Não consegui enviar ${failed} de ${total}`;
}
