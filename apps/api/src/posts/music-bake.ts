import { RATE } from '../compose/plan';
import { MUSIC_SOUND_OK } from '../sounds/sounds.service';

/**
 * A música gravada no vídeo das tchekas (o contrato).
 *
 * Uma tcheka publicada com uma música à parte (`POST /posts` com um vídeo e `music`/`soundId`, sem a montagem do estúdio)
 * guardava a música ao lado do vídeo e a app tocava-a por cima. Agora, ao publicar, fica um trabalho em
 * content.post_music_bakes e o worker (MusicBakeService) faz um vídeo novo com a música misturada, com as regras de som da
 * montagem (compose/plan.ts, `finalArgs`): o trecho desde `music_start_ms` em ciclo, cortado à duração do vídeo, a música
 * × `music_volume` e o som do vídeo × `original_volume`, `amix` sem normalizar e um limitador. A imagem não se volta a
 * comprimir (`-c:v copy`).
 *
 * Na publicação (FEED_SQL): enquanto o vídeo com a música não estiver pronto, ou se a música deixar de se poder ouvir (som
 * tirado, faixa de artista escondida por denúncia, ficheiros apagados), vai o vídeo original e a música à parte, como antes.
 * Pronto, o `media[i].url` do vídeo passa a ser o do vídeo com a música (a capa fica a do original) e
 * **`musicBaked: true`**: a app não toca a `music` por cima (sem som a dobrar). A `music` e o `sound` continuam na publicação,
 * para o crédito e o «Usar este som». `musicBaked` também vem a true quando o vídeo publicado já trazia a música (montagem do
 * servidor, ou o estúdio do site com `musicInFile: true` no POST /posts): estado 'inline'.
 *
 * O que não se grava: a música licenciada (o contrato com o fornecedor não o deixa: a montagem também a recusa), faixas do
 * catálogo com licença que não seja aberta (OPEN_LICENSES) ou de um anfitrião fora da lista, duetos e respostas com tcheka
 * (o estúdio do remix já mistura o som), e publicações com mais de um ficheiro.
 */

export type BakeStatus = 'queued' | 'working' | 'done' | 'failed' | 'skipped' | 'inline';

/** Os volumes por omissão da montagem (compose.service, resolveSpec): «Usar este som» cala o som do vídeo; a música a 70 % por cima de um vídeo. */
export function bakeMix(viaSound: boolean): { originalVolume: number; musicVolume: number; musicStartMs: number } {
  return viaSound ? { originalVolume: 0, musicVolume: 1, musicStartMs: 0 } : { originalVolume: 1, musicVolume: 0.7, musicStartMs: 0 };
}

const n = (x: number, d = 3) => (Math.round(x * 10 ** d) / 10 ** d).toString();

/**
 * Os argumentos do ffmpeg que gravam a música no vídeo (entradas: 0 o vídeo, 1 a música em ciclo). Como o fim de
 * `finalArgs` da montagem: o som do vídeo (se tiver e se o volume não for 0) e a música desde o trecho, `amix` sem
 * normalizar e `alimiter`; com um canal só, passa como está. A imagem copia-se.
 */
export function bakeArgs(o: { video: string; music: string; seconds: number; hasAudio: boolean; originalVolume: number; musicVolume: number; musicStartMs: number; out: string }): string[] {
  const T = n(o.seconds);
  const fmt = `aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  const start = Math.max(0, o.musicStartMs / 1000);
  const g: string[] = [`[1:a]atrim=${n(start)}:${n(start + o.seconds)},asetpts=PTS-STARTPTS,${fmt},volume=${n(o.musicVolume)},apad,atrim=end=${T}[am]`];
  if (o.hasAudio && o.originalVolume > 0) {
    g.push(`[0:a]asetpts=PTS-STARTPTS,${fmt},volume=${n(o.originalVolume)},apad,atrim=end=${T}[ao]`);
    g.push(`[ao][am]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97:level=0[aout]`);
  } else {
    g.push(`[am]anull[aout]`);
  }
  return [
    '-y',
    '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,matroska,webm', '-i', o.video,
    '-stream_loop', '-1', '-protocol_whitelist', 'file', '-format_whitelist', 'mp3,mov,mp4,m4a,aac,ogg,wav,flac,matroska,webm', '-i', o.music,
    '-filter_complex', g.join(';'),
    '-map', '0:v:0', '-map', '[aout]', '-t', T,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', String(RATE),
    '-movflags', '+faststart', '-map_metadata', '-1', o.out,
  ];
}

/**
 * O vídeo com a música ainda vale para esta publicação (`p` = content.posts, `b` = content.post_music_bakes): feito, os dois
 * ficheiros prontos, e a música ainda se pode ouvir (as mesmas regras que deixam de a tocar à parte: o som original não foi
 * tirado, MUSIC_SOUND_OK; a faixa de um artista não está escondida nem tirada, como em ArtistsService.audio).
 */
export const BAKE_PLAYABLE = (p = 'p', b = 'pmb') => `(${b}.status = 'done' AND ${b}.media_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM content.media_assets bm WHERE bm.id = ${b}.media_id AND bm.status = 'ready')
    AND EXISTS (SELECT 1 FROM content.media_assets bs WHERE bs.id = ${b}.source_media_id AND bs.status = 'ready')
    AND ${p}.music IS NOT NULL AND ${MUSIC_SOUND_OK(p)}
    AND (${p}.music->>'source' IS DISTINCT FROM 'local' OR EXISTS (SELECT 1 FROM content.artist_tracks bt JOIN identity.users bu ON bu.id = bt.artist_id
          WHERE bt.id::text = ${p}.music->>'trackId' AND bt.status IN ('approved', 'withdrawn') AND bt.hold_at IS NULL AND bu.status = 'active')))`;

/** Para o FEED_SQL: a junção e as colunas (`bake_status`, `bake_source`, `bake_media` só quando vale). */
export const BAKE_JOIN = (p = 'p') => `LEFT JOIN content.post_music_bakes pmb ON pmb.post_id = ${p}.id`;
export const BAKE_COLS = (p = 'p') => `pmb.status AS bake_status, pmb.source_media_id AS bake_source, CASE WHEN ${BAKE_PLAYABLE(p)} THEN pmb.media_id END AS bake_media`;

/** O vídeo a mostrar: o com a música, quando vale e é este; senão o próprio. */
export function bakedMediaId(mediaId: string, row: { bake_source?: unknown; bake_media?: unknown }): string {
  return row.bake_media && row.bake_source === mediaId ? String(row.bake_media) : mediaId;
}

/** `musicBaked` da publicação: a música já vai no vídeo que a app recebe. */
export const musicBakedOf = (row: { bake_status?: unknown; bake_media?: unknown }) => row.bake_status === 'inline' || !!row.bake_media;
