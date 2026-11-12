/**
 * Ficheiros que já levam a assinatura do Txillapp (o logótipo e o @), gravada pela câmara da app: a TxillCam no site
 * (TxCamera), o editor de fotos no telemóvel (PhotoEditor) e o estúdio de tchekas (TchekaStudio). Vão marcados com
 * `signed: true` até ao pedido de envio, para o servidor não voltar a assinar a cópia que se guarda de um mimo (a letra e a
 * sombra do @ do servidor não são as da app e o @ ficava a dobrar, desfocado). Fotos e vídeos da galeria não vão marcados:
 * o servidor assina-os ao guardar, como sempre.
 */

/** Uma foto ou vídeo pronto a enviar; `signed` só quando já leva a assinatura da app. */
export interface MaybeSigned { uri: string; video: boolean; mime: string; durationMs?: number; signed?: boolean }

/** A foto que sai do editor de fotos do telemóvel (PhotoEditor): JPEG, sempre com a assinatura. */
export const editedPhoto = (uri: string) => ({ uri, video: false, mime: 'image/jpeg', signed: true });

/** O corpo do pedido de envio (POST /media/uploads). `signed` só vai quando é verdade (as versões antigas não o mandam). */
export function uploadRequest(mime: string, size: number, purpose: 'public' | 'chat', signed?: boolean): { mime: string; size: number; purpose: 'public' | 'chat'; signed?: true } {
  return signed ? { mime, size, purpose, signed: true } : { mime, size, purpose };
}

/** Parâmetros da rota do editor do mimo (/stories/new) para uma foto ou vídeo vindo da câmara do "+". */
export function mimoParams(s: MaybeSigned): { uri: string; video: '1' | '0'; mime: string; signed?: '1' } {
  return { uri: s.uri, video: s.video ? '1' : '0', mime: s.mime, ...(s.signed ? { signed: '1' as const } : {}) };
}

/** O contrário de `mimoParams`: a foto ou vídeo que o editor do mimo recebe pela rota (null sem `uri`). */
export function mimoFromParams(p: { uri?: string; video?: string; mime?: string; signed?: string }): MaybeSigned | null {
  if (!p.uri) return null;
  const video = p.video === '1';
  return { uri: String(p.uri), video, mime: String(p.mime || (video ? 'video/mp4' : 'image/jpeg')), ...(p.signed === '1' ? { signed: true } : {}) };
}
