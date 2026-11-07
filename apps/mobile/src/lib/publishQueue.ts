import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError, raw } from './api';
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
  /** 0–1 do envio dos ficheiros. */
  progress: number;
  error: string | null;
  job: PublishJob;
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

/** Envia um ficheiro com progresso (XHR: o fetch não diz quanto já foi). */
async function uploadWithProgress(a: PublishAsset, onProgress: (p: number) => void): Promise<string> {
  const blob = await (await fetch(a.uri)).blob();
  const up = (await raw('/media/uploads', { method: 'POST', body: JSON.stringify({ mime: a.mime, size: blob.size, purpose: 'public' }) })) as { assetId: string; uploadUrl: string };
  const url = /^https?:\/\//.test(up.uploadUrl) ? up.uploadUrl : `${SITE_URL}${up.uploadUrl}`;
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', a.mime);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new ApiError(x.status, 'Não consegui enviar o ficheiro')));
    x.onerror = () => reject(new ApiError(0, 'Sem ligação. Vê a rede e tenta outra vez.'));
    x.send(blob);
  });
  await raw(`/media/${up.assetId}/complete`, { method: 'POST' });
  return up.assetId;
}

async function run(id: string, qc: QueryClient) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  patch(id, { status: 'uploading', progress: 0, error: null });
  try {
    const ids: string[] = [];
    const n = t.job.assets.length;
    for (let i = 0; i < n; i++) {
      ids.push(await uploadWithProgress(t.job.assets[i], (p) => patch(id, { progress: (i + p) / n })));
    }
    patch(id, { progress: 1 });
    await composeApi.createPost({ ...t.job.post, mediaIds: ids });
    patch(id, { status: 'done' });
    void Promise.all([qc.invalidateQueries({ queryKey: ['feed'] }), qc.invalidateQueries({ queryKey: ['profile-posts'] })]);
    setTimeout(() => { tasks = tasks.filter((x) => x.id !== id); emit(); }, 3500);
  } catch (e) {
    patch(id, { status: 'error', error: (e as Error).message || 'Não consegui publicar' });
  }
}

/** Põe a publicação na fila e começa já. Devolve o id da tarefa. */
export function enqueuePublish(job: PublishJob, qc: QueryClient): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const first = job.assets[0];
  tasks = [...tasks, { id, thumb: first && !first.video ? first.uri : null, video: !!first?.video, status: 'uploading', progress: 0, error: null, job }];
  emit();
  void run(id, qc);
  return id;
}

export const retryPublish = (id: string, qc: QueryClient) => void run(id, qc);
export function dropPublish(id: string) {
  tasks = tasks.filter((x) => x.id !== id);
  emit();
}
