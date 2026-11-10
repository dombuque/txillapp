/**
 * Cortar fotos ao centro numa proporção (carrossel das publicações, como no Instagram), no browser, com um canvas.
 * Os browsers aplicam a orientação EXIF ao desenhar a imagem (`image-orientation: from-image`, por omissão em todos os
 * atuais), por isso as dimensões e o corte já são os da foto direita; o JPEG gravado sai sem metadados.
 * Se algo falhar, devolve-se a foto original em vez de bloquear.
 */

/** Lado maior do JPEG cortado (nunca se aumenta a foto; só se reduz se for maior do que isto). */
const MAX_SIDE = 2048;

function load(uri: string): Promise<HTMLImageElement | null> {
  return new Promise((done) => {
    const i = document.createElement('img');
    i.style.imageOrientation = 'from-image';
    i.onload = () => done(i);
    i.onerror = () => done(null);
    i.src = uri;
  });
}

/** Proporção (largura/altura, já com a orientação EXIF) da foto, ou null se não se conseguir ler. */
export async function imageRatio(uri: string): Promise<number | null> {
  if (typeof document === 'undefined') return null;
  const img = await load(uri);
  return img && img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null;
}

/** JPEG da foto cortada ao centro na proporção `ratio` (largura/altura), como URL de objeto. A ±1% da proporção, devolve a própria foto. */
export async function cropToRatio(uri: string, ratio: number): Promise<string> {
  if (!(ratio > 0) || typeof document === 'undefined') return uri;
  try {
    const img = await load(uri);
    if (!img) return uri;
    if (img.decode) await img.decode().catch(() => undefined);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h || Math.abs(w / h / ratio - 1) <= 0.01) return uri;
    const cw = Math.min(w, h * ratio), ch = cw / ratio;
    const k = Math.min(1, MAX_SIDE / Math.max(cw, ch));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(cw * k));
    c.height = Math.max(1, Math.round(c.width / ratio));
    const g = c.getContext('2d');
    if (!g) return uri;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return blob && blob.size > 0 ? URL.createObjectURL(blob) : uri;
  } catch {
    return uri;
  }
}

/** No browser a foto do mimo vem da câmara do site (já no tamanho do ecrã): vai como está. */
export async function shrinkPhoto(uri: string): Promise<string> {
  return uri;
}
