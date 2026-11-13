/**
 * Os rascunhos do estúdio no telemóvel: ficheiros no diretório de documentos da app (testado em
 * tests/studioNativeDrafts.test.mjs com um sistema de ficheiros falso).
 *
 *   <raiz>/<id>/draft.json      o projeto (os clipes sem o caminho do ficheiro, o som, as camadas, a capa…)
 *   <raiz>/<id>/files.json      a chave de cada ficheiro → o nome dele nesta pasta
 *   <raiz>/<id>/m-<chave>.<ext> os ficheiros dos clipes e da voz-off, **copiados** (a galeria e a câmara podem apagar os delas)
 *
 * É um `DraftBackend` (lib/studio/drafts.ts): a loja de sempre (`createDraftStore`) trata do resto (um ficheiro por `media`,
 * apagar os que já não se usam, no máximo 10 rascunhos). Aqui o «valor» de um ficheiro é o caminho dele.
 *
 * Só importa tipos (o node corre este ficheiro direto).
 */
import type { DraftBackend, MediaValue, StudioDraft } from './drafts';

/** O pouco que é preciso do sistema de ficheiros (no telemóvel: expo-file-system; nos testes: um mapa em memória). */
export interface DraftFs {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  /** Copia um ficheiro (por cima do que lá estiver). */
  copy(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Apaga um ficheiro ou uma pasta inteira (se não existir, não faz mal). */
  remove(path: string): Promise<void>;
  /** Os nomes dentro de uma pasta ([] se não existir). */
  list(dir: string): Promise<string[]>;
  mkdir(dir: string): Promise<void>;
}

const join = (a: string, b: string) => `${a.replace(/\/+$/, '')}/${b}`;
/** Um nome de ficheiro seguro a partir de uma chave do projeto. */
export const safeName = (key: string) => key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'f';
/** A extensão de um caminho («mp4», «jpg»); sem ela, pelo tipo. */
export function extOf(uri: string, mime?: string): string {
  const m = /\.([a-zA-Z0-9]{2,5})(?:[?#].*)?$/.exec(uri);
  if (m) return m[1].toLowerCase();
  if (mime?.startsWith('video/')) return mime === 'video/quicktime' ? 'mov' : 'mp4';
  if (mime?.startsWith('audio/')) return mime === 'audio/mp4' ? 'm4a' : 'audio';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return mime?.startsWith('image/') ? 'jpg' : 'bin';
}

type Files = Record<string, string>;

export function fileDraftBackend(fs: DraftFs, root: string): DraftBackend {
  const dir = (id: string) => join(root, safeName(id));
  const readJson = async <T>(path: string): Promise<T | null> => {
    try { const t = await fs.readText(path); return t ? (JSON.parse(t) as T) : null; } catch { return null; }
  };
  const files = async (id: string): Promise<Files> => (await readJson<Files>(join(dir(id), 'files.json'))) ?? {};
  const saveFiles = (id: string, f: Files) => fs.writeText(join(dir(id), 'files.json'), JSON.stringify(f));
  /** Sem miniatura guardada, a lista mostra a primeira foto do rascunho (o ficheiro copiado). */
  const withPoster = async (d: StudioDraft): Promise<StudioDraft> => {
    if (d.poster) return d;
    const f = await files(d.id);
    const photo = (d.media ?? []).find((m) => m.mime.startsWith('image/') && f[m.key]);
    return photo ? { ...d, poster: join(dir(d.id), f[photo.key]) } : d;
  };
  const valid = (d: StudioDraft | null): d is StudioDraft => !!d && typeof d.id === 'string' && Array.isArray(d.clips);

  return {
    async putDraft(d) {
      await fs.mkdir(dir(d.id));
      // A miniatura que aponta para um ficheiro de fora não se guarda (pode desaparecer): a lista usa a foto copiada.
      const { poster, ...rest } = d;
      const keep = poster && (poster.startsWith('data:') || poster.startsWith(dir(d.id))) ? { poster } : {};
      await fs.writeText(join(dir(d.id), 'draft.json'), JSON.stringify({ ...rest, ...keep }));
    },
    async getDraft(id) {
      const d = await readJson<StudioDraft>(join(dir(id), 'draft.json'));
      return valid(d) ? withPoster(d) : null;
    },
    async listDrafts() {
      const out: StudioDraft[] = [];
      for (const name of await fs.list(root)) {
        const d = await readJson<StudioDraft>(join(join(root, name), 'draft.json'));
        if (valid(d)) out.push(await withPoster(d));
      }
      return out;
    },
    async deleteDraft(id) { await fs.remove(dir(id)); },
    async putMedia(id, key, v: MediaValue) {
      if (typeof v !== 'string' || !v) return;
      await fs.mkdir(dir(id));
      const f = await files(id);
      const name = `m-${safeName(key)}.${extOf(v)}`;
      const to = join(dir(id), name);
      // Um rascunho reaberto já tem os ficheiros cá dentro: não se copiam para cima deles próprios.
      if (v !== to) await fs.copy(v, to);
      f[key] = name;
      await saveFiles(id, f);
    },
    async getMedia(id, key) {
      const name = (await files(id))[key];
      if (!name) return null;
      const path = join(dir(id), name);
      return (await fs.exists(path)) ? path : null;
    },
    async mediaKeys(id) { return Object.keys(await files(id)); },
    async deleteMedia(id, key) {
      const f = await files(id);
      const name = f[key];
      if (!name) return;
      await fs.remove(join(dir(id), name));
      delete f[key];
      if (await fs.exists(dir(id))) await saveFiles(id, f);
    },
  };
}

/** Um sistema de ficheiros em memória (para os testes): os caminhos são chaves, as pastas são prefixos. */
export function memoryFs(seed: Record<string, string> = {}): DraftFs & { files: Map<string, string>; copies: number } {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>();
  const api = {
    files,
    copies: 0,
    async readText(p: string) { return files.has(p) ? files.get(p)! : null; },
    async writeText(p: string, t: string) { files.set(p, t); },
    async copy(from: string, to: string) { if (!files.has(from)) throw new Error(`sem ficheiro: ${from}`); files.set(to, files.get(from)!); api.copies += 1; },
    async exists(p: string) { return files.has(p) || dirs.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`)); },
    async remove(p: string) { files.delete(p); dirs.delete(p); for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k); },
    async list(d: string) {
      const pre = `${d.replace(/\/+$/, '')}/`;
      const names = new Set<string>();
      for (const k of files.keys()) if (k.startsWith(pre)) names.add(k.slice(pre.length).split('/')[0]);
      return [...names];
    },
    async mkdir(d: string) { dirs.add(d); },
  };
  return api;
}
