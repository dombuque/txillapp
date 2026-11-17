import { Directory, File, Paths } from 'expo-file-system';

/**
 * Os ficheiros das mensagens de voz, fotos e vídeos à espera de rede (lib/chatPending), na app nativa: uma cópia na pasta
 * de documentos da app (`tx-chat-media/`), para não se perderem ao sair da conversa nem ao fechar a app (a gravação e as
 * fotos da câmara ficam na cache, que o sistema pode limpar). Guarda-se só o nome (a pasta da app pode mudar de sítio
 * numa atualização no iPhone). Na web é o IndexedDB (chatMediaStore.web.ts).
 */
const dir = () => new Directory(Paths.document, 'tx-chat-media');
const safe = (ref: string) => ref.replace(/[^A-Za-z0-9._-]/g, '');

function extOf(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.startsWith('audio/')) return 'm4a';
  if (mime.includes('png')) return 'png';
  if (mime.includes('heic')) return 'heic';
  if (mime.startsWith('image/')) return 'jpg';
  if (mime.includes('quicktime')) return 'mov';
  return 'mp4';
}

/** O tamanho do ficheiro (bytes), se der para saber. */
export async function chatMediaSize(uri: string): Promise<number | null> {
  try {
    const s = new File(uri).size;
    return typeof s === 'number' ? s : null;
  } catch {
    return null;
  }
}

/** Guarda uma cópia do ficheiro. Devolve a referência (para a fila) e onde se vê. Lança se não conseguir. */
export async function keepChatMedia(uri: string, mime: string): Promise<{ ref: string; uri: string }> {
  const d = dir();
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${extOf(mime)}`;
  const dest = new File(d, ref);
  await new File(uri).copy(dest);
  return { ref, uri: dest.uri };
}

/** Onde se vê um ficheiro guardado (null se já não existe). */
export async function chatMediaUri(ref: string): Promise<string | null> {
  try {
    const f = new File(dir(), safe(ref));
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

export function dropChatMedia(ref: string): void {
  try {
    const f = new File(dir(), safe(ref));
    if (f.exists) f.delete();
  } catch {
    /* já não existe */
  }
}
