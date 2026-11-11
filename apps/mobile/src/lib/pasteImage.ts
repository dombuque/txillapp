/**
 * Colar ou arrastar uma imagem para a caixa de mensagem (site): a lógica pura, sem React nem DOM
 * (os testes em tests/pasteImage.test.mjs importam este ficheiro diretamente).
 *
 * - `imageFromTransfer`: a imagem de um DataTransfer (o `clipboardData` de um `paste`, o `dataTransfer` de um `drop` ou
 *   de um `beforeinput`). O texto colado fica como está: se a área de transferência tiver texto, cola-se o texto
 *   (o Excel, o Word e o Notas juntam uma imagem do próprio texto e não se quer enviar essa foto).
 * - `pastedImageProblem`: o que o servidor não aceita (formato e tamanho), para avisar logo em vez de falhar no envio.
 * - `createPasteGate`: o iPhone, no "Fotografia — Colar das capturas de ecrã" do teclado, pode disparar `paste` e
 *   `beforeinput` para a mesma imagem; só a primeira conta.
 */

/** O que se usa de um File (ou Blob com nome). */
export interface FileLike { readonly type: string; readonly size: number; readonly name?: string }
/** O que se usa de um DataTransferItem. */
export interface ItemLike { readonly kind: string; readonly type: string; getAsFile(): FileLike | null }
/** O que se usa de um DataTransfer. */
export interface TransferLike {
  readonly items?: ArrayLike<ItemLike> | null;
  readonly files?: ArrayLike<FileLike> | null;
  readonly types?: ArrayLike<string> | null;
  getData?(format: string): string;
}
/** A imagem encontrada: o ficheiro e o tipo (o do ficheiro, ou o do item quando o browser o dá sem tipo). */
export interface FoundImage<F extends FileLike = FileLike> { file: F; type: string }

/** Os formatos de imagem que o servidor guarda no chat (apps/api/src/media/media.service.ts, ALLOWED). */
export const SENDABLE_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
/** O máximo de uma imagem no servidor (MAX_IMAGE_BYTES). */
export const MAX_PASTED_IMAGE_BYTES = 8 * 1024 * 1024;

const isImage = (type: string | undefined): type is string => typeof type === 'string' && /^image\//i.test(type);

function list<T>(xs: ArrayLike<T> | null | undefined): T[] {
  if (!xs) return [];
  const out: T[] = [];
  for (let i = 0; i < xs.length; i++) if (xs[i] != null) out.push(xs[i]);
  return out;
}

/** Tem texto (não só espaços) para colar? */
function hasText(dt: TransferLike): boolean {
  const types = list(dt.types);
  if (types.length && !types.includes('text/plain')) return false;
  let text = '';
  try { text = dt.getData?.('text/plain') ?? ''; } catch { /* sem acesso ao texto */ }
  return text.trim().length > 0;
}

/**
 * A primeira imagem de um DataTransfer, ou null (texto, nada, ou um ficheiro que não é imagem).
 * `preferText` (colar): se também houver texto, ganha o texto. Ao arrastar, um ficheiro é sempre um ficheiro.
 * O tipo fica o do ficheiro (um GIF continua GIF).
 */
export function imageFromTransfer<F extends FileLike = FileLike>(dt: TransferLike | null | undefined, { preferText = true } = {}): FoundImage<F> | null {
  if (!dt) return null;
  if (preferText && hasText(dt)) return null;
  for (const it of list(dt.items)) {
    if (it.kind !== 'file' || !isImage(it.type)) continue;
    let f: FileLike | null = null;
    try { f = it.getAsFile(); } catch { /* o browser já não deixa ler */ }
    if (f && f.size > 0) return { file: f as F, type: (isImage(f.type) ? f.type : it.type).toLowerCase() };
  }
  for (const f of list(dt.files)) if (isImage(f.type) && f.size > 0) return { file: f as F, type: f.type.toLowerCase() };
  return null;
}

/** Arrastar por cima: há ficheiros no que se arrasta? (para deixar largar). */
export function transferHasFiles(dt: TransferLike | null | undefined): boolean {
  if (!dt) return false;
  if (list(dt.types).includes('Files')) return true;
  return list(dt.items).some((it) => it.kind === 'file');
}

/** Porque é que esta imagem não dá para enviar (texto para mostrar), ou null se dá. */
export function pastedImageProblem(img: FoundImage): string | null {
  if (img.type === 'image/gif') return 'Os GIFs que colas ou arrastas ainda não dão para enviar. Usa o separador GIF dos stickers.';
  if (!SENDABLE_IMAGE_TYPES.includes(img.type)) return 'Esta imagem não dá para enviar: só JPEG, PNG ou WebP.';
  if (img.file.size > MAX_PASTED_IMAGE_BYTES) return 'A imagem é grande demais (máximo 8 MB).';
  return null;
}

/** A mesma imagem chega duas vezes seguidas (`paste` e `beforeinput`)? Guarda a última e deixa passar só uma. */
export function createPasteGate(windowMs = 1500) {
  let last: { key: string; at: number } | null = null;
  return {
    /** true: é nova, trata-se. false: é a mesma de há bocado (ignora-se). */
    accept(img: FoundImage, now: number): boolean {
      // O iPhone dá um File novo em cada evento (outro `lastModified`), por isso compara-se o tipo, o tamanho e o nome.
      const key = `${img.type}|${img.file.size}|${img.file.name ?? ''}`;
      if (last && last.key === key && now - last.at >= 0 && now - last.at < windowMs) return false;
      last = { key, at: now };
      return true;
    },
    reset() { last = null; },
  };
}
