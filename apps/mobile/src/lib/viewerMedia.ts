/**
 * O que o visor em ecrã inteiro (PhotoViewer) mostra de uma publicação: TODOS os itens, fotos e vídeos, pela ordem da
 * publicação. Antes só passavam as fotos: numa publicação com fotos e vídeos o contador dizia «1/2» e o visor abria
 * noutra foto que não a tocada (o iPhone do dono, 1.59).
 */
import type { PhotoTag } from './api.feed';

export interface ViewerPhoto {
  url: string;
  /** Sem `kind` (ou 'image') é uma foto. */
  kind?: 'image' | 'video';
  width?: number | null;
  height?: number | null;
  tags?: PhotoTag[];
  /** Vídeo: a capa enquanto carrega. */
  posterUrl?: string;
  durationMs?: number | null;
}

type Media = { url: string; kind?: 'image' | 'video'; posterUrl?: string; width?: number | null; height?: number | null; durationMs?: number | null; tags?: PhotoTag[] };

/** Os itens da publicação para o visor, pela ordem dela (fotos com as etiquetas, vídeos com a capa). */
export function viewerMedia(media: readonly Media[] | null | undefined): ViewerPhoto[] {
  return (media ?? []).map((m) =>
    m.kind === 'video'
      ? { url: m.url, kind: 'video' as const, width: m.width, height: m.height, posterUrl: m.posterUrl, durationMs: m.durationMs }
      : { url: m.url, width: m.width, height: m.height, tags: m.tags },
  );
}

/** O item onde o visor abre: o tocado, contado entre TODOS os itens (fotos e vídeos), dentro dos limites. */
export function viewerStart(start: number, total: number): number {
  if (!Number.isFinite(start) || total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, Math.floor(start)));
}

export const isViewerVideo = (m: Pick<ViewerPhoto, 'kind'> | null | undefined) => m?.kind === 'video';
