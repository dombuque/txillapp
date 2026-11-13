import type { Pool, PoolClient } from 'pg';

/**
 * Onde um ficheiro (content.media_assets) pode estar a ser usado. É esta lista que decide se um envio está «por publicar»
 * (UnusedMediaService apaga-o 48 horas depois; a exportação mostra-o em «Envios por publicar»).
 *
 * Apagar um ficheiro em uso é pior do que deixá-lo ficar: uma coluna nova que guarde o id de um ficheiro tem de entrar aqui.
 * O teste media-refs.spec.ts lê as migrações e falha se aparecer uma coluna `*_media_id` (ou que referencie
 * content.media_assets) ou uma coluna jsonb que não esteja nesta lista nem em JSON_WITHOUT_MEDIA.
 */

/** Colunas com o id de um ficheiro. `where`: só contam as linhas que cumprem a condição (a tabela tem o alias `t`). */
export interface MediaColumnRef { table: string; column: string; where?: string; why: string }

export const MEDIA_COLUMN_REFS: MediaColumnRef[] = [
  { table: 'content.post_media', column: 'media_id', why: 'fotos e vídeos das publicações (também as removidas ou apagadas)' },
  { table: 'content.photo_tags', column: 'media_id', why: 'pessoas identificadas numa foto' },
  { table: 'content.stories', column: 'media_id', why: 'mimos (também os expirados e os partilhados de uma publicação)' },
  { table: 'identity.users', column: 'avatar_media_id', why: 'foto de perfil' },
  { table: 'social.messages', column: 'media_id', why: 'fotos, vídeos e áudios das mensagens' },
  { table: 'social.messages', column: 'story_media_id', why: 'resposta a um mimo ou a um Zás (leva a foto)' },
  { table: 'social.instants', column: 'media_id', why: 'Zás' },
  { table: 'identity.verification_requests', column: 'doc_media_id', why: 'verificação: documento' },
  { table: 'identity.verification_requests', column: 'doc_back_media_id', why: 'verificação: verso do documento' },
  { table: 'identity.verification_requests', column: 'selfie_media_id', why: 'verificação: selfie' },
  { table: 'identity.verification_requests', column: 'face_media_id', why: 'verificação: rosto' },
  { table: 'content.venues', column: 'avatar_media_id', why: 'logótipo de um local' },
  { table: 'content.venues', column: 'cover_media_id', why: 'capa de um local' },
  { table: 'content.venue_events', column: 'cover_media_id', why: 'capa de um evento' },
  { table: 'social.groups', column: 'avatar_media_id', why: 'foto de um TxillGroup' },
  { table: 'social.groups', column: 'cover_media_id', why: 'capa de um TxillGroup' },
  { table: 'content.artist_profiles', column: 'proof_media_id', why: 'prova de direitos do pedido de artista' },
  { table: 'content.artist_tracks', column: 'audio_media_id', why: 'música de artista (original)' },
  { table: 'content.artist_tracks', column: 'preview_media_id', why: 'música de artista (trecho)' },
  { table: 'content.artist_tracks', column: 'cover_media_id', why: 'capa de uma música de artista' },
  { table: 'content.sounds', column: 'audio_media_id', why: 'áudio de um som original' },
  { table: 'content.sounds', column: 'cover_media_id', why: 'capa de um som (o vídeo da tcheka)' },
  { table: 'content.sound_silenced', column: 'media_id', why: 'vídeo a que se tirou o som (e a cópia privada)' },
  // O vídeo montado à espera de ir num POST /posts não conta: o pedido fica 7 dias, o vídeo sem publicar só 48 horas.
  { table: 'content.compose_jobs', column: 'media_id', where: `t.status IN ('queued', 'working')`, why: 'montagem ainda ativa' },
  // A foto em revisão (0144); os outros ficheiros do rascunho contam por ACTIVE_HELD_PAYLOAD.
  { table: 'content.held_publications', column: 'media_id', where: `t.status = 'held'`, why: 'publicação guardada à espera da revisão da foto' },
];

/** Colunas jsonb que guardam ids de ficheiros em chaves de topo (`{ mediaId, audioMediaId, coverMediaId, … }`). */
export interface MediaJsonRef { table: string; column: string; keys: string[]; why: string }

/** As chaves com ids de ficheiros nas músicas e nas faixas guardadas (clipe próprio, som original, faixa de artista). */
const MUSIC_KEYS = ['mediaId', 'audioMediaId', 'coverMediaId', 'previewMediaId'];

export const MEDIA_JSON_REFS: MediaJsonRef[] = [
  { table: 'content.posts', column: 'music', keys: MUSIC_KEYS, why: 'música da publicação (clipe de áudio próprio, som)' },
  { table: 'content.stories', column: 'music', keys: MUSIC_KEYS, why: 'música do mimo' },
  { table: 'social.notes', column: 'music', keys: MUSIC_KEYS, why: 'música da nota' },
  { table: 'content.sounds', column: 'track', keys: MUSIC_KEYS, why: 'a faixa de um som (capa de artista)' },
  { table: 'content.music_catalog', column: 'track', keys: MUSIC_KEYS, why: 'faixa do catálogo' },
  { table: 'content.music_favorites', column: 'track', keys: MUSIC_KEYS, why: 'faixa favorita' },
];

/**
 * Colunas jsonb que não guardam ids de ficheiros (ou só guardam ids que não seguram o ficheiro), com o motivo.
 * content.compose_jobs.spec está aqui porque é tratada à parte (ACTIVE_COMPOSE_SPEC): qualquer id no pedido de uma
 * montagem ainda ativa conta como uso (os clipes, a voz-off, o áudio e o dueto).
 */
export const JSON_WITHOUT_MEDIA: Record<string, string> = {
  'audit.audit_log.metadata': 'registo de auditoria (o alvo vai em texto)',
  'ledger.transactions.metadata': 'movimentos de Txills',
  'social.notifications.data': 'avisos (ids de publicações, nunca de ficheiros)',
  'analytics.events.props': 'estatísticas de uso',
  'social.reports.evidence': 'cópia do texto de uma mensagem denunciada (sem ficheiros)',
  'content.posts.geleira': 'retrato da geleira partilhada (nomes, slugs e notas dos gostos; os desenhos vêm do catálogo, sem ficheiros)',
  'social.messages.gif': 'GIF do GIPHY (endereço externo)',
  'social.messages.system': 'avisos de sistema na conversa',
  'content.comments.gif': 'GIF do GIPHY (endereço externo)',
  'content.stories.stickers': 'stickers do catálogo (ids de stickers)',
  'content.moderation_removals.snapshot': 'cópia de comentários removidos (sem ficheiros)',
  'content.music_catalog.signals': 'sinais da curadoria',
  'content.music_catalog.cover_tint': 'cores da capa',
  'content.artist_profiles.links': 'ligações externas do artista',
  'payments.iap_purchases.raw': 'resposta da loja',
  'payments.iap_events.data': 'notificação da loja',
  'content.compose_jobs.spec': 'tratada à parte: qualquer id numa montagem ativa conta',
  'content.held_publications.payload': 'tratada à parte: qualquer id numa publicação guardada (à espera da revisão) conta',
};

/** O pedido de uma montagem ainda ativa: os ids que lá estiverem (em qualquer campo) contam como uso. */
export const ACTIVE_COMPOSE_SPEC = `SELECT x.id FROM unnest($1::uuid[]) AS x(id)
   WHERE EXISTS (SELECT 1 FROM content.compose_jobs j WHERE j.status IN ('queued', 'working') AND strpos(j.spec::text, x.id::text) > 0)`;

/**
 * O rascunho de uma publicação guardada à espera da revisão de uma foto (0144, HeldPublicationsService): os ids que lá
 * estiverem (as outras fotos e vídeos, o clipe da música) contam como uso enquanto estiver 'held' (até 7 dias).
 */
export const ACTIVE_HELD_PAYLOAD = `SELECT x.id FROM unnest($1::uuid[]) AS x(id)
   WHERE EXISTS (SELECT 1 FROM content.held_publications h WHERE h.status = 'held' AND strpos(h.payload::text, x.id::text) > 0)`;

/**
 * Uma foto assinalada pela verificação automática, ou uma foto recusada com pedido de revisão do dono, com a denúncia por
 * decidir: a moderação ainda a tem de ver. (As recusadas, 'rejected', nem entram na limpeza das 48 horas.)
 */
export const OPEN_MEDIA_REPORTS = `SELECT r.target_id AS id FROM social.reports r WHERE r.target_type = 'media' AND r.status = 'open' AND r.target_id = ANY($1::uuid[])`;

/** O SQL que devolve, dos ids em $1 (uuid[]), os que estão a ser usados em algum lado. */
export function referencedSql(): string {
  const parts = [
    ...MEDIA_COLUMN_REFS.map((r) => `SELECT t.${r.column} AS id FROM ${r.table} t WHERE t.${r.column} = ANY($1::uuid[])${r.where ? ` AND ${r.where}` : ''}`),
    ...MEDIA_JSON_REFS.flatMap((r) => r.keys.map((k) => `SELECT (t.${r.column}->>'${k}')::uuid AS id FROM ${r.table} t WHERE t.${r.column}->>'${k}' = ANY($1::uuid[]::text[])`)),
    ACTIVE_COMPOSE_SPEC,
    ACTIVE_HELD_PAYLOAD,
    OPEN_MEDIA_REPORTS,
  ];
  return parts.map((p) => `(${p})`).join('\nUNION\n');
}

const SQL = referencedSql();

/** Dos ids dados, os que estão a ser usados. */
export async function referencedAmong(db: Pool | PoolClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await db.query(SQL, [ids]);
  return new Set(rows.map((r) => r.id as string));
}
