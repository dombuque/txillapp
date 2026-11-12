import type { Track } from './api.music';

/**
 * Um «som» do Txillapp (contrato comum com a equipa dos sons: `GET /sounds/:id`): o áudio original de uma tcheka, uma
 * faixa do catálogo ou de um artista de Moçambique. `/som/[id]` é a página dele; `/tcheka/nova?som=<id>` abre o estúdio com ele.
 */
export interface Sound {
  id: string;
  kind: 'original' | 'catalog' | 'local';
  title: string;
  author?: string | null;
  cover?: string | null;
  durationMs?: number | null;
  previewUrl: string;
  uses?: number;
  /** Nos sons do catálogo e dos artistas: a faixa (para o post levar a música como sempre). */
  music?: Track | null;
  /** Andamento, se a faixa o tiver (no nativo, a montagem ao ritmo usa-o; sem ele, 120 BPM). */
  bpm?: number | null;
}

/**
 * O som como faixa para o estúdio e para o seletor: toca do `previewUrl`. Um som original vai como `kind: 'sound'`
 * (o estúdio começa com o som original dos vídeos calado, como para dobrar).
 */
export function soundTrack(s: Sound): Track & { bpm?: number } {
  const base = s.music ?? null;
  return {
    ...(base ?? {}),
    kind: base?.kind ?? (s.kind === 'original' ? 'sound' : 'music'),
    id: base?.id ?? `sound:${s.id}`,
    title: s.title || base?.title || 'Som original',
    artist: s.author ?? base?.artist ?? '',
    url: s.previewUrl || base?.url || '',
    landing: base?.landing ?? null,
    license: base?.license ?? '',
    licenseUrl: base?.licenseUrl ?? null,
    durationMs: s.durationMs ?? base?.durationMs ?? null,
    cover: s.cover ?? base?.cover ?? null,
    ...(s.bpm ? { bpm: s.bpm } : {}),
  };
}

/**
 * O que a publicação leva de som: o `soundId` (quando se usou um som e não se trocou de música no estúdio) e a música.
 * Um som original não é uma faixa: só vai o `soundId`. Com música do seletor, vai só a música (o servidor tira dela o som).
 */
export function soundForPost(sound: Sound | null, music: Track | null): { soundId?: string; music: Track | null } {
  if (!sound) return { music };
  const used = !!music && music.id === soundTrack(sound).id;
  if (!used) return { music };
  return { soundId: sound.id, music: sound.kind === 'original' ? null : sound.music ?? null };
}
