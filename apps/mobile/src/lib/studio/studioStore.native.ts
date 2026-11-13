/**
 * Os rascunhos do estúdio no telemóvel: pastas no diretório de documentos da app (lib/studio/nativeDraftFiles.ts), com a
 * loja de sempre (`createDraftStore`), e o registo da montagem em curso (`job.json` na pasta do rascunho), para a app
 * retomar a montagem quando volta do segundo plano ou quando se abre outra vez.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { createDraftStore, type DraftStore } from './drafts';
import { parseRecord, type JobRecord } from './composeJob';
import { fileDraftBackend, safeName, type DraftFs } from './nativeDraftFiles';

const ROOT = `${Paths.document.uri.replace(/\/+$/, '')}/estudio-rascunhos`;

const nativeFs: DraftFs = {
  async readText(p) { const f = new File(p); return f.exists ? f.text() : null; },
  async writeText(p, t) { const f = new File(p); if (!f.exists) f.create({ intermediates: true }); await f.write(t); },
  async copy(from, to) {
    const dest = new File(to);
    if (dest.exists) dest.delete();
    await new File(from).copy(dest);
  },
  async exists(p) {
    try { if (new File(p).exists) return true; } catch { /* não é um ficheiro */ }
    try { return new Directory(p).exists; } catch { return false; }
  },
  async remove(p) {
    try { const f = new File(p); if (f.exists) { f.delete(); return; } } catch { /* talvez seja uma pasta */ }
    try { const d = new Directory(p); if (d.exists) d.delete(); } catch { /* já não existe */ }
  },
  async list(dir) {
    try { const d = new Directory(dir); return d.exists ? d.list().map((x) => x.name) : []; } catch { return []; }
  },
  async mkdir(dir) { const d = new Directory(dir); if (!d.exists) d.create({ intermediates: true, idempotent: true }); },
};

let shared: DraftStore | null = null;
export function studioStore(): DraftStore {
  return (shared ??= createDraftStore(fileDraftBackend(nativeFs, ROOT), { readMedia: async (uri) => uri, toUrl: (v) => String(v) }));
}

const jobFile = (draftId: string) => `${ROOT}/${safeName(draftId)}/job.json`;
export async function loadJobRecord(draftId: string): Promise<JobRecord | null> {
  try { return parseRecord(await nativeFs.readText(jobFile(draftId))); } catch { return null; }
}
export async function saveJobRecord(rec: JobRecord): Promise<void> {
  try { await nativeFs.mkdir(`${ROOT}/${safeName(rec.draftId)}`); await nativeFs.writeText(jobFile(rec.draftId), JSON.stringify(rec)); } catch { /* sem espaço: fica só em memória */ }
}
export async function clearJobRecord(draftId: string): Promise<void> {
  try { await nativeFs.remove(jobFile(draftId)); } catch { /* já não existe */ }
}
/** O registo de montagem mais recente com uma montagem pedida (para «A tua tcheka acabou de montar» ao abrir a app). */
export async function latestJobRecord(): Promise<JobRecord | null> {
  let best: JobRecord | null = null;
  for (const name of await nativeFs.list(ROOT)) {
    const r = parseRecord(await nativeFs.readText(`${ROOT}/${name}/job.json`).catch(() => null));
    if (r?.jobId && !r.cancelled && (!best || (r.at ?? 0) > (best.at ?? 0))) best = r;
  }
  return best;
}
