import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError, putBlob, raw, readLocalBlob, releaseBlob, waitMediaReady, type MediaState } from './api';
import { POST_MAX_SIDE, shrinkPhoto } from './cropToRatio';
import { composeApi } from './api.compose';
import { SITE_URL } from './config';
import { uploadRequest } from './signedMedia';
import { appealOutcome, type AppealState, type AppealStatus, type HeldDraft, rejectedPhotoId } from './photoAppeal';
import { musicPayload } from './api.music';

/**
 * Publicar em segundo plano (como no Instagram): o cartão fecha logo e o envio continua aqui, com uma faixa no Início a
 * mostrar o progresso. Se falhar, a faixa deixa tentar outra vez ou descartar. Vive enquanto a app estiver aberta.
 */
/** `signed`: já leva a assinatura do Txillapp (câmara da app); o servidor não a volta a pôr (ver lib/signedMedia). */
/** `posterMs`: num vídeo do estúdio de tchekas, o instante da capa escolhido (vai no /complete). */
/** `mediaId`: já está no servidor (o vídeo montado pelo estúdio nativo): não se envia, só se espera que esteja pronto. */
export interface PublishAsset { uri: string; mime: string; video: boolean; signed?: boolean; posterMs?: number; mediaId?: string }
export interface PublishJob {
  assets: PublishAsset[];
  post: Parameters<typeof composeApi.createPost>[0] extends infer P ? Omit<P, 'mediaIds'> : never;
}
export interface PublishTask {
  id: string;
  /** O que se está a enviar: publicação, mimo ou Zás (muda o texto da faixa). */
  kind: 'post' | 'mimo' | 'zas';
  /** Mimos e Zás: como enviar (a publicação usa `job`). */
  runner?: (onProgress: (p: number) => void, onStage: (s: PublishTask['stage']) => void) => Promise<void>;
  /** Miniatura (a primeira foto, ou o poster do vídeo se houver). */
  thumb: string | null;
  video: boolean;
  status: 'uploading' | 'done' | 'error';
  /** Em que passo vai: enviar os ficheiros, o servidor a preparar o vídeo, ou a criar a publicação. */
  stage: 'upload' | 'prepare' | 'post';
  /** 0–1 do envio dos ficheiros. */
  progress: number;
  error: string | null;
  job: PublishJob;
  /** Ficheiros já enviados (por posição): ao tentar outra vez não se enviam de novo. */
  sent: (string | undefined)[];
  /** Uma foto recusada pela verificação automática: o pedido de revisão (ver lib/photoAppeal). */
  appeal?: { assetId: string; state: AppealState };
  /** Mimos e Zás: o rascunho para o servidor publicar sozinho quando a foto for aprovada (com o id da foto). */
  draft?: (mediaId: string) => HeldDraft;
}

const listeners = new Set<() => void>();
let tasks: PublishTask[] = [];
const emit = () => listeners.forEach((l) => l());
const patch = (id: string, p: Partial<PublishTask>) => { tasks = tasks.map((t) => (t.id === id ? { ...t, ...p } : t)); emit(); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => void listeners.delete(cb); };
const snapshot = () => tasks;

export function usePublishTasks(): PublishTask[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Envia um ficheiro com progresso (XHR: o fetch não diz quanto já foi). Devolve o id e a resposta do /complete. */
async function uploadWithProgress(a: PublishAsset, onProgress: (p: number) => void): Promise<{ assetId: string; state: MediaState }> {
  // Última defesa: uma foto que chegue aqui à resolução original (12–50 MP) é reduzida antes de subir.
  const src = a.video ? a.uri : await shrinkPhoto(a.uri, POST_MAX_SIDE, POST_MAX_SIDE);
  const mime = src === a.uri ? a.mime : 'image/jpeg';
  const blob = await readLocalBlob(src);
  let up: { assetId: string; uploadUrl: string };
  try {
    up = (await raw('/media/uploads', { method: 'POST', body: JSON.stringify(uploadRequest(mime, blob.size, 'public', a.signed)) })) as { assetId: string; uploadUrl: string };
    const url = /^https?:\/\//.test(up.uploadUrl) ? up.uploadUrl : `${SITE_URL}${up.uploadUrl}`;
    await putBlob(url, blob, mime, onProgress);
  } finally {
    releaseBlob(blob); // cada foto sai da memória antes de a seguinte ser lida
  }
  const state = (await raw(`/media/${up.assetId}/complete`, a.video && a.posterMs != null ? { method: 'POST', body: JSON.stringify({ posterMs: a.posterMs }) } : { method: 'POST' })) as MediaState;
  return { assetId: up.assetId, state };
}

async function run(id: string, qc: QueryClient) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  patch(id, { status: 'uploading', stage: 'upload', error: null });
  if (t.runner) {
    try {
      await t.runner((p) => patch(id, { progress: p }), (stage) => patch(id, { stage }));
      patch(id, { status: 'done', progress: 1 });
      setTimeout(() => { tasks = tasks.filter((x) => x.id !== id); emit(); }, 2500);
    } catch (e) {
      const rid = rejectedPhotoId(e);
      patch(id, { status: 'error', error: (e as Error).message || 'Não consegui enviar', appeal: rid ? { assetId: rid, state: 'available' } : undefined });
    }
    return;
  }
  const sent = [...t.sent];
  try {
    const n = t.job.assets.length;
    // Primeiro envia-se tudo; os vídeos convertem no servidor enquanto os outros ficheiros sobem.
    const pending: { i: number; state: MediaState }[] = [];
    let rejected: unknown = null;
    for (let i = 0; i < n; i++) {
      const known = sent[i];
      if (known) {
        // Já foi enviado numa tentativa anterior: se o servidor o recusou ou perdeu, envia-se de novo.
        let state: MediaState | null = null;
        try { state = (await raw(`/media/${known}/status`)) as MediaState; } catch (e) { if ((e as ApiError).status !== 404) throw e; }
        // Recusada pela verificação automática (à espera da revisão): não se volta a enviar.
        if (state?.status === 'rejected') {
          rejected ??= new ApiError(422, state.error ?? 'Esta foto parece mostrar nudez e não pode ser publicada.', 'nudity_rejected', { assetId: known });
          continue;
        }
        if (state && state.status !== 'deleted') { pending.push({ i, state }); continue; }
        sent[i] = undefined;
      }
      patch(id, { stage: 'upload' });
      let up: { assetId: string; state: MediaState };
      try {
        up = await uploadWithProgress(t.job.assets[i], (p) => patch(id, { progress: (i + p) / n }));
      } catch (e) {
        // Foto recusada: fica no servidor (7 dias) para o pedido de revisão. Os outros ficheiros sobem na mesma: o
        // rascunho que vai com o pedido leva-os todos (o servidor publica-o sozinho se a foto for aprovada).
        const rid = rejectedPhotoId(e);
        if (!rid) throw e;
        sent[i] = rid;
        rejected ??= e;
        patch(id, { sent: [...sent], progress: (i + 1) / n });
        continue;
      }
      const { assetId, state } = up;
      sent[i] = assetId;
      patch(id, { sent: [...sent], progress: (i + 1) / n });
      pending.push({ i, state });
    }
    if (rejected) throw rejected;
    // Um vídeo é convertido no servidor (MP4, até 60 s): a publicação só pode ser criada quando todos estiverem prontos.
    for (const p of pending) {
      try {
        await waitMediaReady(sent[p.i]!, p.state, () => patch(id, { stage: 'prepare' }));
      } catch (e) {
        if ((e as ApiError).status === 422) sent[p.i] = undefined; // recusado: na próxima tentativa envia-se de novo
        throw e;
      }
    }
    patch(id, { progress: 1, stage: 'post' });
    await composeApi.createPost({ ...t.job.post, mediaIds: sent as string[] });
    patch(id, { status: 'done' });
    void Promise.all([qc.invalidateQueries({ queryKey: ['feed'] }), qc.invalidateQueries({ queryKey: ['profile-posts'] })]);
    setTimeout(() => { tasks = tasks.filter((x) => x.id !== id); emit(); }, 3500);
  } catch (e) {
    const rid = rejectedPhotoId(e);
    const prev = tasks.find((x) => x.id === id)?.appeal;
    const appeal = rid ? (prev?.assetId === rid ? prev : { assetId: rid, state: 'available' as const }) : undefined;
    patch(id, { status: 'error', sent: [...sent], error: (e as Error).message || 'Não consegui publicar', appeal });
  }
}

/** Põe a publicação na fila e começa já. Devolve o id da tarefa. */
export function enqueuePublish(job: PublishJob, qc: QueryClient): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const first = job.assets[0];
  const thumb = first && !first.video ? first.uri : first?.mediaId ? `${SITE_URL}/api/v1/media/${first.mediaId}?poster=1` : null;
  tasks = [...tasks, { id, kind: 'post', thumb, video: !!first?.video, status: 'uploading', stage: 'upload', progress: 0, error: null, job, sent: job.assets.map((a) => a.mediaId) }];
  emit();
  void run(id, qc);
  return id;
}

/** Mimos e Zás em segundo plano: o ecrã fecha logo e o envio segue aqui (com a mesma faixa no Início). */
/** `draft`: o rascunho a guardar no servidor com um pedido de revisão (o servidor publica-o sozinho se a foto for aprovada). */
export function enqueueTask(kind: 'mimo' | 'zas', asset: PublishAsset, runner: NonNullable<PublishTask['runner']>, qc: QueryClient, draft?: (mediaId: string) => HeldDraft): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  tasks = [...tasks, { id, kind, runner, draft, thumb: asset.video ? null : asset.uri, video: asset.video, status: 'uploading', stage: 'upload', progress: 0, error: null, job: { assets: [asset], post: { body: '' } as PublishJob['post'] }, sent: [] }];
  emit();
  void run(id, qc);
  return id;
}

export const retryPublish = (id: string, qc: QueryClient) => void run(id, qc);
export function dropPublish(id: string) {
  tasks = tasks.filter((x) => x.id !== id);
  stopWatching(id);
  emit();
}

/** Pedidos de revisão à espera da moderação: de quanto em quanto tempo se pergunta (enquanto a app estiver aberta). */
const APPEAL_POLL_MS = 30_000;
const watching = new Map<string, ReturnType<typeof setInterval>>();
function stopWatching(id: string) {
  const w = watching.get(id);
  if (w) clearInterval(w);
  watching.delete(id);
}
const setAppeal = (id: string, state: AppealState, error?: string) => {
  const t = tasks.find((x) => x.id === id);
  if (t?.appeal) patch(id, { appeal: { ...t.appeal, state }, ...(error ? { error } : {}) });
};

/** O rascunho da publicação para guardar no servidor com o pedido de revisão (null: não há como o fazer). */
function draftOf(t: PublishTask, assetId: string): HeldDraft | null {
  if (t.runner) return t.draft ? t.draft(assetId) : null;
  // Publicação: o mesmo corpo que composeApi.createPost manda (todos os ficheiros têm de estar no servidor).
  if (t.sent.length !== t.job.assets.length || t.sent.some((x) => !x)) return null;
  const b = t.job.post;
  return { kind: 'post', payload: { ...b, music: b.remixOf && b.music === null ? null : musicPayload(b.music), mediaIds: t.sent as string[] } };
}

/**
 * Atualiza a faixa com a decisão, enquanto a app estiver aberta. Com o rascunho guardado no servidor, a tarefa não espera
 * por nada (o servidor publica sozinho, mesmo com a app fechada): só se mostra o resultado. Sem rascunho, aprovada a
 * foto, a publicação (ou o mimo, ou o Zás) segue daqui.
 */
function watchAppeal(id: string, qc: QueryClient) {
  stopWatching(id);
  const tick = async () => {
    const t = tasks.find((x) => x.id === id);
    if (!t?.appeal || (t.appeal.state !== 'pending' && t.appeal.state !== 'held')) return stopWatching(id);
    let st: AppealStatus;
    try { st = (await raw(`/media/${t.appeal.assetId}/status`)) as AppealStatus; } catch { return; /* sem rede: tenta no próximo */ }
    const out = appealOutcome(st);
    if (out === 'waiting') return;
    stopWatching(id);
    if (out === 'refused') return setAppeal(id, 'refused', st.error ?? 'A moderação reviu a foto e manteve a recusa.');
    if (out === 'published') {
      setAppeal(id, 'published');
      void Promise.all([qc.invalidateQueries({ queryKey: ['feed'] }), qc.invalidateQueries({ queryKey: ['profile-posts'] }), qc.invalidateQueries({ queryKey: ['stories'] })]);
      setTimeout(() => dropPublish(id), 6000);
      return;
    }
    if (out === 'held_failed') {
      // Aprovada, mas o servidor não conseguiu publicar: fica «Tentar outra vez» (publica-se daqui, à mão).
      return patch(id, { appeal: undefined, error: `A foto foi aprovada, mas não consegui publicar${st.held?.error ? ` (${st.held.error})` : ''}. Tenta outra vez.` });
    }
    patch(id, { appeal: undefined });
    void run(id, qc);
  };
  watching.set(id, setInterval(() => void tick(), APPEAL_POLL_MS));
}

/**
 * «Pedir revisão»: a foto recusada vai para a fila da moderação (POST /media/:id/appeal; só o dono, uma vez, até 7 dias),
 * com o rascunho da publicação, que fica guardado no servidor e é publicado lá quando a foto for aprovada.
 */
export async function appealPublish(id: string, qc: QueryClient) {
  const t = tasks.find((x) => x.id === id);
  if (!t?.appeal || !['available', 'failed'].includes(t.appeal.state)) return;
  const assetId = t.appeal.assetId;
  setAppeal(id, 'sending');
  const draft = draftOf(t, assetId);
  let held = false;
  try {
    held = !!((await raw(`/media/${assetId}/appeal`, { method: 'POST', body: JSON.stringify(draft ? { draft } : {}) })) as { held?: boolean }).held;
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 400 && draft) {
      // O rascunho não passou nas regras de publicar: pede-se a revisão só da foto (a app continua a publicação depois).
      try {
        await raw(`/media/${assetId}/appeal`, { method: 'POST', body: '{}' });
      } catch (e2) {
        if ((e2 as ApiError).status !== 409) return setAppeal(id, 'failed', (e2 as Error).message || 'Não consegui pedir a revisão. Tenta outra vez.');
      }
    } else if (err.status !== 409) {
      // 409: já tinha sido pedido (noutro aparelho, ou a resposta perdeu-se): fica à espera na mesma.
      return setAppeal(id, 'failed', err.message || 'Não consegui pedir a revisão. Tenta outra vez.');
    }
  }
  setAppeal(id, held ? 'held' : 'pending');
  watchAppeal(id, qc);
}
