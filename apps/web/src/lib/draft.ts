/**
 * Rascunho da publicação, guardado só neste aparelho (IndexedDB, para aguentar fotos).
 * Um rascunho por conta. Se o armazenamento não estiver disponível, falha em silêncio.
 */
export interface Draft {
  body: string;
  place: string;
  photos: File[];
  /** Identificações por foto (mesma ordem de photos). */
  tags?: { username: string; displayName: string; x: number; y: number }[][];
  savedAt: number;
}

const DB = 'txillapp';
const STORE = 'drafts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).finally(() => db.close());
  } catch {
    return undefined;
  }
}

export const loadDraft = (userId: string) => run<Draft | undefined>('readonly', (s) => s.get(userId) as IDBRequest<Draft | undefined>);
export const saveDraft = (userId: string, d: Omit<Draft, 'savedAt'>) => run('readwrite', (s) => s.put({ ...d, savedAt: Date.now() }, userId));
export const clearDraft = (userId: string) => run('readwrite', (s) => s.delete(userId));
