/**
 * Guardar uma tcheka (sem React, para os testes em node): a API devolve o vídeo com a assinatura do Txillapp e, no fim, o
 * cartão com o logótipo e o @ de quem publicou (`GET /posts/:id/download`). No telemóvel vai para a galeria; no site abre a
 * folha de partilha do sistema (no telemóvel) ou descarrega o ficheiro (no computador). O feed continua sem o cartão.
 */

export interface DownloadablePost {
  id: string;
  code?: string | null;
  kind?: string;
  media: readonly { kind?: string }[];
  repostOf?: DownloadablePost | null;
}

/** A publicação de onde sai o vídeo: a própria, ou o original de um repost simples (sem fotos nem vídeo próprios). */
export function downloadTarget(p: DownloadablePost | null | undefined): DownloadablePost | null {
  if (!p) return null;
  if (p.media.some((m) => m.kind === 'video')) return p;
  if (p.kind === 'repost' && p.media.length === 0 && p.repostOf) return downloadTarget(p.repostOf);
  return null;
}

/** Tem um vídeo para guardar (as tchekas e os carrosséis com vídeo). */
export const canDownload = (p: DownloadablePost | null | undefined) => !!downloadTarget(p);

/** O caminho da API (sem o /api/v1) e o nome do ficheiro. */
export const downloadPath = (p: DownloadablePost) => `/posts/${encodeURIComponent(p.id)}/download`;
export const downloadName = (p: DownloadablePost) => `txillapp-tcheka-${String(p.code || p.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)}.mp4`;
