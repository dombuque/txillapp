/**
 * A rede do «Seguinte» no estúdio nativo: enviar os ficheiros (com progresso e a retomar se a rede cair), pedir a montagem
 * e perguntar por ela até acabar. As decisões (o que enviar, as fases, as mensagens) estão em lib/studio/composeJob.ts.
 */
import { ApiError, post, putBlob, raw, readLocalBlob, releaseBlob, waitMediaReady, type MediaState } from '@/lib/api';
import { SITE_URL } from '@/lib/config';
import { POST_MAX_SIDE, shrinkPhoto } from '@/lib/cropToRatio';
import { uploadRequest } from '@/lib/signedMedia';
import {
  isNetworkError, POLL_MAX_FAILURES, pollDelay, pollOutcome, preparingState, retryDelay, serverState, UPLOAD_RETRIES, uploadPlan, uploadState,
  withSent, withoutSent, type JobRecord, type PollOutcome, type RunState, type UploadFile,
} from './composeJob';
import type { ComposeRequest } from './composeRequest';

export interface Signal { cancelled: boolean }
export class Cancelled extends Error { constructor() { super('cancelado'); } }
const sleep = (ms: number, signal?: Signal) => new Promise<void>((resolve, reject) => {
  const id = setTimeout(() => (signal?.cancelled ? reject(new Cancelled()) : resolve()), ms);
  if (signal?.cancelled) { clearTimeout(id); reject(new Cancelled()); }
});
const statusOf = (e: unknown) => (e instanceof ApiError ? e.status : (e as { status?: number } | null)?.status);

/** Um ficheiro: pedir o URL, enviar os bytes, confirmar e (nos vídeos e áudios) esperar que fique pronto. */
async function uploadOne(f: UploadFile, onPart: (p: number) => void, onWait: () => void, onSent?: (mediaId: string) => void, waitReady = true): Promise<string> {
  const src = f.kind === 'photo' ? await shrinkPhoto(f.uri, POST_MAX_SIDE, POST_MAX_SIDE).catch(() => f.uri) : f.uri;
  const mime = f.kind === 'photo' ? (src === f.uri ? f.mime : 'image/jpeg') : f.mime;
  const purpose = f.kind === 'voice' ? 'chat' : 'public';
  const blob = await readLocalBlob(src);
  let up: { assetId: string; uploadUrl: string };
  try {
    // Os clipes vão sem a assinatura: é o vídeo final que a leva (docs/montagem.md, 1).
    up = (await raw('/media/uploads', post(uploadRequest(mime, blob.size, purpose)))) as { assetId: string; uploadUrl: string };
    const url = /^https?:\/\//.test(up.uploadUrl) ? up.uploadUrl : `${SITE_URL}${up.uploadUrl}`;
    await putBlob(url, blob, mime, onPart);
  } finally {
    releaseBlob(blob);
  }
  const first = (await raw(`/media/${up.assetId}/complete`, { method: 'POST' })) as MediaState;
  // Os bytes já chegaram: quem precisa do ficheiro antes de estar convertido (o som da Montagem mágica) já o pode pedir.
  onSent?.(up.assetId);
  if (waitReady) await waitMediaReady(up.assetId, first, onWait);
  return up.assetId;
}

/** Um ficheiro já enviado numa tentativa anterior ainda serve? (Pronto, ou a acabar de converter.) */
async function stillThere(mediaId: string, onWait: () => void): Promise<boolean> {
  try {
    const st = (await raw(`/media/${mediaId}/status`)) as MediaState;
    if (st.status === 'deleted' || st.status === 'failed' || st.status === 'rejected') return false;
    await waitMediaReady(mediaId, st, onWait);
    return true;
  } catch (e) {
    if (isNetworkError(statusOf(e))) throw e;
    return false;
  }
}

/**
 * Envia o que falta (os já enviados não voltam a ir). A cada ficheiro guarda o registo (`onRecord`), para uma tentativa
 * seguinte (ou a app aberta outra vez) continuar dali. Uma falha de rede tenta outra vez sozinha, até `UPLOAD_RETRIES`.
 * `onSent`: cada ficheiro logo que os bytes chegam ao servidor (antes de convertido), ou já enviado de uma vez anterior.
 * `waitReady: false` (os envios da Montagem mágica): não espera pela conversão de cada vídeo antes de enviar o seguinte; quem
 * usar os ficheiros depois confirma-os (o «Seguinte» espera por eles em `stillThere`).
 */
export async function uploadAll(files: UploadFile[], rec: JobRecord, o: { signal: Signal; onState: (s: RunState) => void; onRecord: (r: JobRecord) => void; onSent?: (key: string, mediaId: string) => void; waitReady?: boolean }): Promise<{ ids: Record<string, string>; rec: JobRecord }> {
  let cur = rec;
  const { ready } = uploadPlan(files, cur);
  const ids: Record<string, string> = {};
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (o.signal.cancelled) throw new Cancelled();
    let attempt = 0;
    for (;;) {
      try {
        o.onState(uploadState(i, files.length, 0, f.kind, attempt));
        const known = ready[f.key];
        if (known && attempt === 0) o.onSent?.(f.key, known);
        if (known && attempt === 0 && o.waitReady === false) { ids[f.key] = known; break; }
        if (known && attempt === 0 && (await stillThere(known, () => o.onState(preparingState())))) { ids[f.key] = known; break; }
        if (known) { cur = withoutSent(cur, f.key); delete ready[f.key]; }
        const id = await uploadOne(f, (p) => o.onState(uploadState(i, files.length, p, f.kind, attempt)), () => o.onState(preparingState()), (m) => o.onSent?.(f.key, m), o.waitReady !== false);
        ids[f.key] = id;
        cur = withSent(cur, f.key, { uri: f.uri, mediaId: id });
        o.onRecord(cur);
        break;
      } catch (e) {
        if (e instanceof Cancelled || o.signal.cancelled) throw new Cancelled();
        if (!isNetworkError(statusOf(e)) || attempt >= UPLOAD_RETRIES) throw e;
        attempt += 1;
        o.onState(uploadState(i, files.length, 0, f.kind, attempt));
        await sleep(retryDelay(attempt), o.signal);
      }
    }
  }
  return { ids, rec: cur };
}

/** Pede a montagem (202 { jobId }). Os erros vêm como ApiError (400 com a dica, 409, 429…). */
export async function requestCompose(body: ComposeRequest): Promise<string> {
  const r = (await raw('/tchekas/compose', post(body))) as { jobId?: string };
  if (!r?.jobId) throw new ApiError(500, 'O servidor não respondeu com a montagem.');
  return r.jobId;
}

export type PollEnd = PollOutcome | { kind: 'lost' };
/**
 * Pergunta pela montagem de 1 em 1 s até acabar. Com a rede em baixo abranda e, depois de muitas falhas seguidas, desiste
 * (`lost`): a montagem continua no servidor e retoma-se mais tarde (`Cancelled` se a pessoa deixou de esperar).
 */
export async function pollJob(jobId: string, o: { signal: Signal; onState: (s: RunState) => void; startedAt: number; paused?: () => boolean }): Promise<PollEnd> {
  let failures = 0;
  for (;;) {
    if (o.signal.cancelled) throw new Cancelled();
    // Em segundo plano não se pergunta (a app volta a perguntar logo que regressa).
    if (o.paused?.()) { await sleep(1000, o.signal); continue; }
    let out: PollOutcome;
    try {
      const body = (await raw(`/tchekas/compose/${encodeURIComponent(jobId)}`)) as { status?: string; progress?: number; mediaId?: string; durationMs?: number; error?: string };
      failures = 0;
      out = pollOutcome(200, body);
      if (out.kind === 'wait') o.onState(serverState(body.status ?? 'working', body.progress ?? 0, Date.now() - o.startedAt));
    } catch (e) {
      const st = statusOf(e);
      if (st === 404) return { kind: 'gone' };
      if (!isNetworkError(st) && st !== 502 && st !== 503 && st !== 504) throw e;
      failures += 1;
      if (failures > POLL_MAX_FAILURES) return { kind: 'lost' };
      out = { kind: 'wait' };
    }
    if (out.kind !== 'wait') return out;
    await sleep(pollDelay(failures), o.signal);
  }
}
