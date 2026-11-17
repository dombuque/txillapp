/**
 * Na web os ficheiros das mensagens de voz, fotos e vídeos à espera de rede (lib/chatPending) ficam no IndexedDB deste
 * browser (sobrevivem a fechar e abrir a app). Se o IndexedDB não der (modo privado, sem espaço), ficam em memória:
 * valem enquanto a página está aberta. Ver chatMediaStore.ts.
 */
import { t } from '@/lib/i18n';
const DB = 'txill-chat-media';
const STORE = 'files';
const mem = new Map<string, Blob>();
const urls = new Map<string, string>();

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (!idb) return resolve(null);
      const r = idb.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((ok, ko) => {
    if (!d) return ko(new Error(t('sem IndexedDB')));
    try {
      const t = d.transaction(STORE, mode);
      const req = f(t.objectStore(STORE));
      t.oncomplete = () => ok(req.result);
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error);
    } catch (e) {
      ko(e);
    }
  }));
}

async function blobOf(uri: string): Promise<Blob> {
  return (await fetch(uri)).blob();
}

/** O tamanho do ficheiro (bytes), se der para saber. */
export async function chatMediaSize(uri: string): Promise<number | null> {
  try {
    return (await blobOf(uri)).size;
  } catch {
    return null;
  }
}

function urlFor(ref: string, b: Blob): string {
  const old = urls.get(ref);
  if (old) return old;
  const u = URL.createObjectURL(b);
  urls.set(ref, u);
  return u;
}

/** Guarda o ficheiro. Devolve a referência (para a fila) e onde se vê. Lança se não conseguir ler o ficheiro. */
export async function keepChatMedia(uri: string, _mime: string): Promise<{ ref: string; uri: string }> {
  const b = await blobOf(uri);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await run('readwrite', (s) => s.put(b, id));
    return { ref: `idb:${id}`, uri: urlFor(`idb:${id}`, b) };
  } catch {
    mem.set(`mem:${id}`, b);
    return { ref: `mem:${id}`, uri: urlFor(`mem:${id}`, b) };
  }
}

/** Onde se vê um ficheiro guardado (null se já não existe, ex.: estava só em memória e a página recarregou). */
export async function chatMediaUri(ref: string): Promise<string | null> {
  const cached = urls.get(ref);
  if (cached) return cached;
  try {
    const b = ref.startsWith('mem:') ? mem.get(ref) : ref.startsWith('idb:') ? await run<Blob | undefined>('readonly', (s) => s.get(ref.slice(4)) as IDBRequest<Blob | undefined>) : undefined;
    return b ? urlFor(ref, b) : null;
  } catch {
    return null;
  }
}

export function dropChatMedia(ref: string): void {
  const u = urls.get(ref);
  if (u) { try { URL.revokeObjectURL(u); } catch { /* já largado */ } }
  urls.delete(ref);
  mem.delete(ref);
  if (ref.startsWith('idb:')) void run('readwrite', (s) => s.delete(ref.slice(4))).catch(() => undefined);
}
