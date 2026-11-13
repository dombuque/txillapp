/**
 * Os vídeos da «Montagem mágica» seguem para o servidor logo que ela abre: é aí que se ouve o som deles
 * (lib/studio/magicSound.ts), e iam ser enviados na mesma no «Seguinte». Os envios ficam no registo do rascunho (o mesmo
 * de lib/studio/composeJob.ts), por isso o «Seguinte» já não os volta a enviar: só confirma que ainda lá estão.
 *
 * Os vídeos vão um a seguir ao outro, sem esperar pela conversão de cada um (o som ouve-se do original). O «Seguinte» espera
 * que os envios acabem (`settleMagicUploads`), mostra o progresso deles e depois confirma cada vídeo (`stillThere`);
 * fechar o estúdio pára-os (`cancelMagicUploads`). O que foi enviado e não se publicar apaga-se sozinho ao fim de 48 horas.
 */
import { loadJobRecord, saveJobRecord } from './studioStore';
import { emptyRecord, preparingState, uploadFiles, uploadPlan, type RunState, type UploadFile } from './composeJob';
import { Cancelled, uploadAll, type Signal } from './composeRunner';

interface Pending {
  files: string;
  signal: Signal;
  ids: Map<string, string>;
  waiters: Map<string, ((id: string | null) => void)[]>;
  done: Promise<void>;
  finished: boolean;
  onState: (s: RunState) => void;
}
const runs = new Map<string, Pending>();

const sigOf = (files: UploadFile[]) => files.map((f) => `${f.key}=${f.uri}`).sort().join('|');

/** Os ficheiros a enviar já: só os vídeos (um por `media`). */
export function magicUploadFiles(clips: readonly { media: string; uri: string; mime: string; video: boolean }[]): UploadFile[] {
  return uploadFiles(clips.filter((c) => c.video));
}

/** Começa (ou continua) a enviar os vídeos deste rascunho. Sem nada para enviar, não faz nada. */
export function startMagicUploads(draftId: string, files: UploadFile[]): void {
  if (!files.length) return;
  const sig = sigOf(files);
  const cur = runs.get(draftId);
  if (cur && !cur.finished && cur.files === sig) return;
  if (cur && !cur.finished) cur.signal.cancelled = true;
  const p: Pending = { files: sig, signal: { cancelled: false }, ids: new Map(cur?.ids ?? []), waiters: new Map(), done: Promise.resolve(), finished: false, onState: () => undefined };
  const sent = (key: string, id: string) => {
    p.ids.set(key, id);
    for (const w of p.waiters.get(key) ?? []) w(id);
    p.waiters.delete(key);
  };
  p.done = (async () => {
    try {
      const rec = (await loadJobRecord(draftId)) ?? emptyRecord(draftId);
      // Os já enviados (numa vez anterior) servem logo para ouvir o som.
      for (const [k, id] of Object.entries(uploadPlan(files, rec).ready)) sent(k, id);
      let last = rec;
      await uploadAll(files, rec, { signal: p.signal, onState: (s) => p.onState(s), onRecord: (r) => { last = r; void saveJobRecord(r); }, onSent: sent, waitReady: false });
      await saveJobRecord(last);
    } catch (e) {
      if (!(e instanceof Cancelled)) { /* sem rede ou recusado: o «Seguinte» envia como sempre */ }
    } finally {
      p.finished = true;
      for (const ws of p.waiters.values()) for (const w of ws) w(null);
      p.waiters.clear();
    }
  })();
  runs.set(draftId, p);
}

/** O `mediaId` de um ficheiro (pela chave `media`) logo que os bytes chegam; `null` se não chegar em `timeoutMs`. */
export function magicMediaId(draftId: string, key: string, timeoutMs: number): Promise<string | null> {
  const p = runs.get(draftId);
  if (!p) return Promise.resolve(null);
  const have = p.ids.get(key);
  if (have) return Promise.resolve(have);
  if (p.finished) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const end = (id: string | null) => { if (!done) { done = true; resolve(id); } };
    const list = p.waiters.get(key) ?? [];
    list.push(end);
    p.waiters.set(key, list);
    setTimeout(() => end(null), Math.max(0, timeoutMs));
  });
}

/** O «Seguinte» espera pelos envios que estejam a meio (e mostra o progresso deles em `onState`). */
export async function settleMagicUploads(draftId: string, onState: (s: RunState) => void): Promise<void> {
  const p = runs.get(draftId);
  if (!p || p.finished) return;
  p.onState = onState;
  onState(preparingState());
  await p.done.catch(() => undefined);
}

/** Pára os envios deste rascunho (fechar o estúdio). */
export function cancelMagicUploads(draftId: string): void {
  const p = runs.get(draftId);
  if (p && !p.finished) p.signal.cancelled = true;
  runs.delete(draftId);
}
