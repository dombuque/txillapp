/**
 * Rascunhos automáticos do estúdio das tchekas (testados em tests/studioDrafts.test.mjs).
 * - O projeto guarda-se a cada mudança (com debounce): os clipes sem o URL (que só vale nesta sessão) e cada ficheiro
 *   uma vez só, como Blob. Os ficheiros que a sequência já não usa apagam-se ao guardar.
 * - Na web vai para o IndexedDB (`txill-studio`: `drafts` e `media`); sem IndexedDB fica em memória (perde-se ao fechar).
 * - Ficam no máximo `MAX_DRAFTS`: os mais antigos saem.
 * - O armazenamento é injetável (`createDraftStore`): os testes usam o de memória.
 *
 * Só importa tipos (o node corre este ficheiro direto).
 */
import type { ProjectClip } from './project';

export const MAX_DRAFTS = 10;
export const DRAFT_DEBOUNCE_MS = 700;
export const DRAFT_VERSION = 1;

/** Um clipe no rascunho: tudo menos o URL do ficheiro. */
export type DraftClip = Omit<ProjectClip, 'uri'>;
export interface StudioDraft {
  id: string;
  v: number;
  savedAt: number;
  clips: DraftClip[];
  /** Os ficheiros (um por `media`). */
  media: { key: string; mime: string }[];
  /** O resto do estúdio (música, filtro, texto, sticker, volumes, capa…): opaco aqui. */
  settings: Record<string, unknown>;
  /** De onde veio (o som de outra tcheka, o dueto): para o ecrã de criar repor. */
  context?: Record<string, unknown>;
  /** Uma miniatura pequena (data URL) para a lista. */
  poster?: string;
  /** Segundos da sequência (para a lista). */
  seconds?: number;
}

export const newDraftId = () => `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** O rascunho de um projeto e os URLs dos ficheiros a guardar (um por `media`). */
export function draftFromProject(o: { id: string; clips: ProjectClip[]; settings?: Record<string, unknown>; context?: Record<string, unknown>; poster?: string; seconds?: number; now?: number }): { draft: StudioDraft; uris: Map<string, string> } {
  const uris = new Map<string, string>();
  const media: StudioDraft['media'] = [];
  const clips: DraftClip[] = o.clips.map((c) => {
    if (!uris.has(c.media)) { uris.set(c.media, c.uri); media.push({ key: c.media, mime: c.mime }); }
    const { uri: _uri, ...rest } = c;
    return rest;
  });
  return {
    draft: { id: o.id, v: DRAFT_VERSION, savedAt: o.now ?? Date.now(), clips, media, settings: o.settings ?? {}, ...(o.context ? { context: o.context } : {}), ...(o.poster ? { poster: o.poster } : {}), ...(o.seconds != null ? { seconds: o.seconds } : {}) },
    uris,
  };
}

/** Os clipes de volta, com o URL de cada ficheiro (os que não têm ficheiro ficam de fora). Repara-se com `normalizeClips`. */
export function clipsFromDraft(d: StudioDraft, urls: Map<string, string>): ProjectClip[] {
  const out: ProjectClip[] = [];
  for (const c of d.clips ?? []) { const uri = urls.get(c.media); if (uri) out.push({ ...c, uri } as ProjectClip); }
  return out;
}

/** «4 clipes · 12 s» */
export function draftLabel(d: Pick<StudioDraft, 'clips' | 'seconds'>): string {
  const n = d.clips?.length ?? 0;
  const s = d.seconds != null ? ` · ${Math.round(d.seconds)} s` : '';
  return `${n} ${n === 1 ? 'clipe' : 'clipes'}${s}`;
}
/** «agora mesmo», «há 5 min», «há 2 h», «ontem», «há 3 dias». */
export function agoLabel(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return 'agora mesmo';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/** Os mais recentes primeiro. */
export const sortDrafts = <T extends { savedAt: number }>(l: T[]) => [...l].sort((a, b) => b.savedAt - a.savedAt);
/** Os que sobram depois dos `keep` mais recentes (para apagar). */
export const overflowDrafts = <T extends { id: string; savedAt: number }>(l: T[], keep = MAX_DRAFTS) => sortDrafts(l).slice(keep).map((d) => d.id);

/** Chama `fn` só depois de `ms` sem chamadas novas; `flush` corre já o que estiver pendente; `cancel` esquece-o. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number, timers: { set: (f: () => void, ms: number) => unknown; clear: (id: unknown) => void } = { set: (f, t) => setTimeout(f, t), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) }) {
  let id: unknown = null;
  let last: A | null = null;
  const run = () => { id = null; const a = last; last = null; if (a) fn(...a); };
  const call = (...a: A) => { last = a; if (id !== null) timers.clear(id); id = timers.set(run, ms); };
  call.flush = () => { if (id !== null) { timers.clear(id); run(); } };
  call.cancel = () => { if (id !== null) timers.clear(id); id = null; last = null; };
  call.pending = () => id !== null;
  return call;
}

// ---------------------------------------------------------------- o armazenamento

export type MediaValue = Blob | string;
export interface DraftBackend {
  putDraft(d: StudioDraft): Promise<void>;
  getDraft(id: string): Promise<StudioDraft | null>;
  listDrafts(): Promise<StudioDraft[]>;
  deleteDraft(id: string): Promise<void>;
  putMedia(draftId: string, key: string, v: MediaValue): Promise<void>;
  getMedia(draftId: string, key: string): Promise<MediaValue | null>;
  mediaKeys(draftId: string): Promise<string[]>;
  deleteMedia(draftId: string, key: string): Promise<void>;
}

/** Em memória (testes, e o browser sem IndexedDB). */
export function memoryBackend(): DraftBackend & { size(): number } {
  const drafts = new Map<string, StudioDraft>();
  const media = new Map<string, MediaValue>();
  const mk = (d: string, k: string) => `${d}|${k}`;
  return {
    async putDraft(d) { drafts.set(d.id, JSON.parse(JSON.stringify(d)) as StudioDraft); },
    async getDraft(id) { const d = drafts.get(id); return d ? (JSON.parse(JSON.stringify(d)) as StudioDraft) : null; },
    async listDrafts() { return [...drafts.values()].map((d) => JSON.parse(JSON.stringify(d)) as StudioDraft); },
    async deleteDraft(id) { drafts.delete(id); },
    async putMedia(d, k, v) { media.set(mk(d, k), v); },
    async getMedia(d, k) { return media.get(mk(d, k)) ?? null; },
    async mediaKeys(d) { return [...media.keys()].filter((x) => x.startsWith(`${d}|`)).map((x) => x.slice(d.length + 1)); },
    async deleteMedia(d, k) { media.delete(mk(d, k)); },
    size: () => media.size,
  };
}

export interface DraftStore {
  /** Guarda o rascunho e os ficheiros novos; apaga os que já não se usam; deixa só os `MAX_DRAFTS` mais recentes. */
  save(o: Parameters<typeof draftFromProject>[0]): Promise<StudioDraft>;
  /** O rascunho com os clipes prontos a usar (URLs novos para os ficheiros). */
  load(id: string): Promise<{ draft: StudioDraft; clips: ProjectClip[] } | null>;
  list(): Promise<StudioDraft[]>;
  remove(id: string): Promise<void>;
  /** Resolve quando as gravações pendentes acabarem (antes de libertar os URLs que elas ainda podem ler). */
  idle(): Promise<void>;
}

/**
 * `readMedia` lê o ficheiro de um URL (na web, `fetch(uri).blob()`; um URL que não seja `blob:` ou `data:` fica como texto,
 * porque continua a valer depois). `toUrl` faz um URL de um Blob lido (na web, `URL.createObjectURL`).
 */
export function createDraftStore(backend: DraftBackend, deps: { readMedia: (uri: string) => Promise<MediaValue>; toUrl: (v: MediaValue) => string }): DraftStore {
  /** Que ficheiros de cada rascunho já estão guardados (e o URL deles nesta sessão, quando se sabe). */
  const stored = new Map<string, Map<string, string>>();
  let chain: Promise<unknown> = Promise.resolve();
  /** As gravações seguem uma atrás da outra (duas seguidas não se atropelam). */
  const serial = <T>(f: () => Promise<T>): Promise<T> => { const p = chain.then(f, f); chain = p.catch(() => undefined); return p; };

  return {
    save: (o) => serial(async () => {
      const { draft, uris } = draftFromProject(o);
      let have = stored.get(draft.id);
      if (!have) { have = new Map((await backend.mediaKeys(draft.id)).map((k) => [k, ''])); stored.set(draft.id, have); }
      for (const [key, uri] of uris) {
        // Cada `media` é sempre o mesmo ficheiro (substituir dá um `media` novo): o que já está guardado não se volta a ler.
        if (have.has(key)) continue;
        await backend.putMedia(draft.id, key, await deps.readMedia(uri));
        have.set(key, uri);
      }
      for (const key of [...have.keys()]) if (!uris.has(key)) { await backend.deleteMedia(draft.id, key); have.delete(key); }
      await backend.putDraft(draft);
      for (const id of overflowDrafts(await backend.listDrafts())) await removeAll(id);
      return draft;
    }),
    load: async (id) => {
      const draft = await backend.getDraft(id);
      if (!draft) return null;
      const urls = new Map<string, string>();
      const have = new Map<string, string>();
      for (const m of draft.media ?? []) {
        const v = await backend.getMedia(id, m.key);
        if (v == null) continue;
        const u = deps.toUrl(v);
        urls.set(m.key, u);
        have.set(m.key, u);
      }
      stored.set(id, have);
      return { draft, clips: clipsFromDraft(draft, urls) };
    },
    list: async () => sortDrafts(await backend.listDrafts()),
    remove: (id) => serial(() => removeAll(id)),
    idle: () => chain.then(() => undefined, () => undefined),
  };
  async function removeAll(id: string) {
    for (const k of await backend.mediaKeys(id)) await backend.deleteMedia(id, k);
    await backend.deleteDraft(id);
    stored.delete(id);
  }
}

// ---------------------------------------------------------------- IndexedDB (web)

const DB = 'txill-studio';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media').createIndex('draft', 'draft');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error('indexeddb'));
  });
}
const done = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error ?? new Error('indexeddb')); });

export function idbBackend(): DraftBackend {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => (dbp ??= idb().catch((e) => { dbp = null; throw e; }));
  const store = async (name: 'drafts' | 'media', mode: IDBTransactionMode) => (await db()).transaction(name, mode).objectStore(name);
  const mk = (d: string, k: string) => `${d}|${k}`;
  return {
    async putDraft(d) { await done((await store('drafts', 'readwrite')).put(d)); },
    async getDraft(id) { return ((await done((await store('drafts', 'readonly')).get(id))) as StudioDraft | undefined) ?? null; },
    async listDrafts() { return (await done((await store('drafts', 'readonly')).getAll())) as StudioDraft[]; },
    async deleteDraft(id) { await done((await store('drafts', 'readwrite')).delete(id)); },
    async putMedia(d, k, v) { await done((await store('media', 'readwrite')).put({ draft: d, key: k, v }, mk(d, k))); },
    async getMedia(d, k) { const x = (await done((await store('media', 'readonly')).get(mk(d, k)))) as { v: MediaValue } | undefined; return x?.v ?? null; },
    async mediaKeys(d) { const rows = (await done((await store('media', 'readonly')).index('draft').getAll(d))) as { key: string }[]; return rows.map((r) => r.key); },
    async deleteMedia(d, k) { await done((await store('media', 'readwrite')).delete(mk(d, k))); },
  };
}

let shared: DraftStore | null = null;
/** O armazenamento dos rascunhos deste browser (IndexedDB; sem ele, em memória). */
export function studioDrafts(): DraftStore {
  if (shared) return shared;
  const hasIdb = typeof indexedDB !== 'undefined';
  shared = createDraftStore(hasIdb ? idbBackend() : memoryBackend(), {
    readMedia: async (uri) => (/^(blob:|data:)/.test(uri) ? await (await fetch(uri)).blob() : uri),
    toUrl: (v) => (typeof v === 'string' ? v : URL.createObjectURL(v)),
  });
  return shared;
}
