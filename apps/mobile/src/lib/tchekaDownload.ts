/**
 * Guardar uma tcheka (sem React, para os testes em node): a API devolve o vídeo com a assinatura do Txillapp e, no fim, o
 * cartão com o logótipo e o @ de quem publicou (`GET /posts/:id/download`). No telemóvel vai para a galeria; no site abre a
 * folha de partilha do sistema (no telemóvel) ou descarrega o ficheiro (no computador). O feed continua sem o cartão.
 *
 * Quem publicou pode não deixar («Deixar guardar as minhas tchekas»; numa conta privada ou de um menor nunca se deixa): a
 * API manda `canDownload: false` e a opção não aparece. Publicações antigas em cache, sem o campo, continuam a mostrá-la (a
 * API responde 403 com a mensagem, que se mostra).
 */

export interface DownloadablePost {
  id: string;
  code?: string | null;
  kind?: string;
  media: readonly { kind?: string }[];
  repostOf?: DownloadablePost | null;
  /** Quem vê pode guardar (a API; num repost, a regra do autor do original). Sem o campo: como antes, pode. */
  canDownload?: boolean;
}

/** A publicação de onde sai o vídeo: a própria, ou o original de um repost simples (sem fotos nem vídeo próprios). */
export function downloadTarget(p: DownloadablePost | null | undefined): DownloadablePost | null {
  if (!p || p.canDownload === false) return null;
  if (p.media.some((m) => m.kind === 'video')) return p;
  if (p.kind === 'repost' && p.media.length === 0 && p.repostOf) return downloadTarget(p.repostOf);
  return null;
}

/** Tem um vídeo para guardar (as tchekas e os carrosséis com vídeo) e quem publicou deixa. */
export const canDownload = (p: DownloadablePost | null | undefined) => !!downloadTarget(p);

/** O caminho da API (sem o /api/v1) e o nome do ficheiro. */
export const downloadPath = (p: DownloadablePost) => `/posts/${encodeURIComponent(p.id)}/download`;
export const downloadName = (p: DownloadablePost) => `txillapp-tcheka-${String(p.code || p.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)}.mp4`;

/** A mensagem da API (403) quando quem publicou não deixa guardar; serve também se a resposta não se puder ler. */
export const DOWNLOAD_BLOCKED = 'Quem publicou não deixa guardar as suas tchekas.';

/** A frase a mostrar quando a API recusa a cópia: a mensagem dela (JSON do Nest), ou uma de reserva. */
export function refusalMessage(status: number, body: unknown): string {
  const m = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
  const text = Array.isArray(m) ? m[0] : m;
  if (typeof text === 'string' && text.trim()) return text;
  if (status === 403) return DOWNLOAD_BLOCKED;
  if (status === 404) return 'Esta tcheka já não está disponível.';
  return 'Não consegui preparar o vídeo. Tenta outra vez.';
}

/**
 * No telemóvel o descarregamento (expo-file-system) não dá o corpo da resposta, só o erro «response has status: 403» (ou
 * «HTTP 403»). Uma recusa que sai logo (403, 404, 422: a API decide antes de preparar o vídeo) devolve o código, para se
 * pedir outra vez só a mensagem; o resto (503, rede) fica null.
 */
export function quickRefusal(error: unknown): number | null {
  const m = /\b(403|404|422)\b/.exec(String((error as { message?: unknown } | null)?.message ?? ''));
  return m ? Number(m[1]) : null;
}

/** GET/PUT /posts/me/download-settings. */
export interface DownloadSettings { allow: boolean; effective: boolean; private: boolean; minor: boolean }

/** A linha «Deixar guardar as minhas tchekas» nas Definições, como «Deixar usar o meu som» (lib/sounds, reuseSetting). */
export function downloadSetting(s: DownloadSettings | null | undefined): { on: boolean; disabled: boolean; description: string } {
  if (!s) return { on: false, disabled: true, description: 'Outras pessoas podem guardar as tuas tchekas e partilhá-las fora do Txillapp.' };
  if (s.private) return { on: false, disabled: true, description: 'A tua conta é privada: ninguém além de ti guarda as tuas tchekas, nem quem te segue.' };
  if (s.minor) return { on: false, disabled: true, description: 'Só contas de maiores de 18 anos (com a data de nascimento indicada) podem deixar guardar as suas tchekas. Tu podes sempre guardar as tuas.' };
  return {
    on: s.allow,
    disabled: false,
    description: s.allow
      ? 'Quem vê as tuas tchekas pode guardá-las e partilhá-las fora do Txillapp, com a assinatura do Txillapp e o teu @ no fim.'
      : 'Desligado: só tu podes guardar as tuas tchekas. As que alguém já guardou ficam com essa pessoa.',
  };
}
