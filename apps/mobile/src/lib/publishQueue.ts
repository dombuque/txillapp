import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError, raw, waitMediaReady, type MediaState } from './api';
import { composeApi } from './api.compose';
import { SITE_URL } from './config';

/**
 * Publicar em segundo plano (como no Instagram): o cartão fecha logo e o envio continua aqui, com uma faixa no Início a
 * mostrar o progresso. Se falhar, a faixa deixa tentar outra vez ou descartar. Vive enquanto a app estiver aberta.
 */
export interface PublishAsset { uri: string; mime: string; video: boolean }
export interface PublishJob {
  assets: PublishAsset[];
  post: Parameters<typeof composeApi.createPost>[0] extends infer P ? Omit<P, 'mediaIds'> : never;
}
export interface PublishTask {
  id: string;
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
  const blob = await (await fetch(a.uri)).blob();
  const up = (await raw('/media/uploads', { method: 'POST', body: JSON.stringify({ mime: a.mime, size: blob.size, purpose: 'public' }) })) as { assetId: string; uploadUrl: string };
  const url = /^https?:\/\//.test(up.uploadUrl) ? up.uploadUrl : `${SITE_URL}${up.uploadUrl}`;
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', a.mime);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      let msg = 'Não consegui enviar o ficheiro';
      try { msg = (JSON.parse(x.responseText) as { message?: string }).message ?? msg; } catch { /* resposta sem JSON */ }
      reject(new ApiError(x.status, msg));
    };
    x.onerror = () => reject(new ApiError(0, 'Sem ligação. Vê a rede e tenta outra vez.'));
    x.send(blob);
  });
  const state = (await raw(`/media/${up.assetId}/complete`, { method: 'POST' })) as MediaState;
  return { assetId: up.assetId, state };
}

async function run(id: string, qc: QueryClient) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  patch(id, { status: 'uploading', stage: 'upload', error: null });
  const sent = [...t.sent];
  try {
    const n = t.job.assets.length;
    // Primeiro envia-se tudo; os vídeos convertem no servidor enquanto os outros ficheiros sobem.
    const pending: { i: number; state: MediaState }[] = [];
    for (let i = 0; i < n; i++) {
      const known = sent[i];
      if (known) {
        // Já foi enviado numa tentativa anterior: se o servidor o recusou ou perdeu, envia-se de novo.
        let state: MediaState | null = null;
        try { state = (await raw(`/media/${known}/status`)) as MediaState; } catch (e) { if ((e as ApiError).status !== 404) throw e; }
        if (state && state.status !== 'deleted') { pending.push({ i, state }); continue; }
        sent[i] = undefined;
      }
      patch(id, { stage: 'upload' });
      const { assetId, state } = await uploadWithProgress(t.job.assets[i], (p) => patch(id, { progress: (i + p) / n }));
      sent[i] = assetId;
      patch(id, { sent: [...sent], progress: (i + 1) / n });
      pending.push({ i, state });
    }
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
    patch(id, { status: 'error', sent: [...sent], error: (e as Error).message || 'Não consegui publicar' });
  }
}

/** Põe a publicação na fila e começa já. Devolve o id da tarefa. */
export function enqueuePublish(job: PublishJob, qc: QueryClient): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const first = job.assets[0];
  tasks = [...tasks, { id, thumb: first && !first.video ? first.uri : null, video: !!first?.video, status: 'uploading', stage: 'upload', progress: 0, error: null, job, sent: [] }];
  emit();
  void run(id, qc);
  return id;
}

export const retryPublish = (id: string, qc: QueryClient) => void run(id, qc);
export function dropPublish(id: string) {
  tasks = tasks.filter((x) => x.id !== id);
  emit();
}
