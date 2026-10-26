/** Versão mais leve de uma foto do servidor (WebP na largura pedida). Fotos de outros sítios ficam como estão. */
export const sized = (url: string, width: number) => (url.startsWith('/api/v1/media/') ? `${url}?w=${width}` : url);

/** `srcset` para o browser escolher a largura certa para o ecrã (e para a ligação). */
export const srcSet = (url: string, widths: number[] = [480, 720, 1080]) =>
  url.startsWith('/api/v1/media/') ? widths.map((w) => `${url}?w=${w} ${w}w`).join(', ') : undefined;
