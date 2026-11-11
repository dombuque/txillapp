import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { SearchIndexer } from '../search/search-index';
import { audienceOk } from '../stories/stories.service';
import { canView } from '../social/visibility';
import { wipeMessage } from '../chat/chat.service';
import { purgeRemovalCopies, removeContent } from './content-removal';

export const REPORT_TYPES = ['post', 'comment', 'story', 'user', 'message', 'media', 'venue'] as const;
/** O que as pessoas podem denunciar ('media' só é criado pela verificação automática; 'venue' é a página de um local, 0121). */
export const USER_REPORT_TYPES = ['post', 'comment', 'story', 'user', 'message', 'venue'] as const;
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'nudity', 'violence', 'scam', 'impersonation', 'minor', 'other'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * Quantos dias fica a prova de uma denúncia (a cópia da mensagem, social.reports.evidence) depois de a denúncia ser
 * decidida. Passado esse prazo a cópia apaga-se (fica a null) e a denúncia continua. As denúncias por decidir mantêm-na.
 */
export const REPORT_EVIDENCE_DAYS = 180;

/** A cópia de uma mensagem guardada no momento da denúncia (social.reports.evidence, 0111). */
export interface MessageEvidence { kind: string; body: string; placeName: string | null; placeAddress: string | null; editedAt: string | null; /** GIF do GIPHY (0113): o url da imagem. */ gifUrl?: string | null }

/**
 * SQL das filas agrupadas por conteúdo (`r` = social.reports, `m` = LEFT JOIN social.messages): a cópia da 1.ª denúncia
 * que a tem e o estado atual da mensagem. Lê-se com `messageProof`.
 */
export const EVIDENCE_COLUMNS = `(array_agg(r.evidence ORDER BY r.created_at) FILTER (WHERE r.evidence IS NOT NULL))[1] AS evidence,
              bool_or(m.id IS NOT NULL) AS cur_exists, bool_or(m.deleted_at IS NOT NULL) AS cur_deleted, max(m.kind) AS cur_kind,
              max(m.body) AS cur_body, max(m.place_name) AS cur_place_name, max(m.place_address) AS cur_place_address, max(m.edited_at) AS cur_edited_at,
              (((array_agg(r.evidence ORDER BY r.created_at) FILTER (WHERE r.evidence IS NOT NULL))[1] ->> 'editedAt')::timestamptz IS NOT DISTINCT FROM max(m.edited_at)) AS cur_edited_same`;

/**
 * O que a moderação vê de uma mensagem denunciada: `reported` (a cópia de quando foi denunciada) e `current` (como está
 * agora), este só quando é diferente da cópia (editada, apagada ou já não existe). Sem cópia (denúncias antigas, ou de
 * outro tipo de conteúdo): os dois a null.
 */
export function messageProof(r: Record<string, any>) {
  const e = (r.evidence as MessageEvidence | null) ?? null;
  if (!e) return { reported: null, current: null };
  const reported = { kind: e.kind, body: e.body ?? '', placeName: e.placeName ?? null, placeAddress: e.placeAddress ?? null, editedAt: e.editedAt ?? null, gifUrl: e.gifUrl ?? null };
  const gone = !r.cur_exists || !!r.cur_deleted;
  const now = {
    kind: gone ? null : (r.cur_kind as string),
    body: gone ? '' : ((r.cur_body as string | null) ?? ''),
    placeName: gone ? null : ((r.cur_place_name as string | null) ?? null),
    placeAddress: gone ? null : ((r.cur_place_address as string | null) ?? null),
    editedAt: gone || !r.cur_edited_at ? null : new Date(r.cur_edited_at as string).toISOString(),
    deleted: gone,
  };
  const same = !gone && now.kind === reported.kind && now.body === reported.body && now.placeName === reported.placeName
    && now.placeAddress === reported.placeAddress && !!r.cur_edited_same;
  return { reported, current: same ? null : now };
}

@Injectable()
export class ModerationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Moderação');
  private purger?: NodeJS.Timeout;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly indexer: SearchIndexer,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** No arranque e de 24 em 24 horas (fora dos testes): apaga as provas das denúncias decididas há mais de REPORT_EVIDENCE_DAYS. */
  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    const run = () => void this.purgeEvidence().catch((e) => this.log.warn(`falha a limpar provas de denúncias: ${(e as Error).message}`));
    run();
    this.purger = setInterval(run, 24 * 3_600_000);
    this.purger.unref();
  }

  onModuleDestroy() {
    if (this.purger) clearInterval(this.purger);
  }

  /**
   * Tira a cópia (evidence) às denúncias decididas há mais de REPORT_EVIDENCE_DAYS dias. A denúncia fica. Devolve quantas mudaram.
   * Também apaga as cópias dos comentários removidos pela moderação há mais do mesmo prazo (content-removal.ts).
   */
  async purgeEvidence(days = REPORT_EVIDENCE_DAYS) {
    const r = await this.pool.query(
      `UPDATE social.reports SET evidence = NULL
        WHERE evidence IS NOT NULL AND status <> 'open' AND resolved_at IS NOT NULL AND resolved_at < now() - make_interval(days => $1)`,
      [days],
    );
    await purgeRemovalCopies(this.pool, days);
    return r.rowCount ?? 0;
  }

  async isAdmin(userId: string) {
    const r = await this.pool.query(`SELECT 1 FROM identity.users WHERE id = $1 AND is_admin AND status = 'active'`, [userId]);
    return !!r.rowCount;
  }

  /** Dono do conteúdo, se o denunciante o consegue ver. Lança 404 caso contrário (não revela o que não pode ver). */
  private async ownerIfVisible(reporter: string, type: ReportType, id: string): Promise<string> {
    let sql: string;
    switch (type) {
      case 'post':
        sql = `SELECT p.author_id AS owner FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL WHERE p.id = $2 AND ${canView()}`;
        break;
      case 'comment':
        sql = `SELECT c.author_id AS owner FROM content.comments c JOIN content.posts p ON p.id = c.post_id AND p.removed_at IS NULL
                 JOIN identity.users u ON u.id = p.author_id WHERE c.id = $2 AND ${canView()}`;
        break;
      case 'story':
        sql = `SELECT s.author_id AS owner FROM content.stories s JOIN identity.users u ON u.id = s.author_id
                WHERE s.id = $2 AND s.expires_at > now() AND ${canView()} AND ${audienceOk('s', '$1')}`;
        break;
      case 'media':
        throw new NotFoundException('Conteúdo não encontrado');
      case 'user':
        // `$1::uuid IS NOT NULL`: o PostgreSQL recusa um parâmetro que não aparece na consulta (o tipo fica por saber).
        sql = `SELECT u.id AS owner FROM identity.users u WHERE u.id = $2 AND u.status = 'active' AND $1::uuid IS NOT NULL`;
        break;
      case 'venue':
        // Só a página de um local já aprovado (as outras ainda não estão à vista de ninguém).
        sql = `SELECT v.owner_id AS owner FROM content.venues v WHERE v.id = $2 AND v.review_status = 'approved' AND $1::uuid IS NOT NULL`;
        break;
      case 'message':
        // De uma conversa a dois em que estou, ou de um TxillGroup de que sou membro (a app oferece "Denunciar" nos dois).
        sql = `SELECT m.sender_id AS owner FROM social.messages m LEFT JOIN social.conversations c ON c.id = m.conversation_id
                WHERE m.id = $2 AND m.deleted_at IS NULL
                  AND (c.user_a = $1 OR c.user_b = $1
                       OR EXISTS (SELECT 1 FROM social.group_members gm WHERE gm.group_id = m.group_id AND gm.user_id = $1))`;
        break;
    }
    const { rows } = await this.pool.query(sql, [reporter, id]);
    if (!rows[0]) throw new NotFoundException('Conteúdo não encontrado');
    return rows[0].owner as string;
  }

  async report(reporter: string, type: Exclude<ReportType, 'media'>, id: string, reason: ReportReason, note?: string) {
    const owner = await this.ownerIfVisible(reporter, type, id);
    if (owner === reporter) throw new BadRequestException('Não podes denunciar o teu próprio conteúdo');
    // Numa mensagem guarda-se a prova (0111): uma cópia do que lá está agora. Denunciar outra vez não a substitui.
    await this.pool.query(
      `INSERT INTO social.reports (id, reporter_id, target_type, target_id, target_user_id, reason, note, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               CASE WHEN $3::text = 'message' THEN (SELECT jsonb_build_object('kind', m.kind, 'body', m.body, 'placeName', m.place_name, 'placeAddress', m.place_address, 'editedAt', m.edited_at, 'gifUrl', m.gif->>'url')
                                                      FROM social.messages m WHERE m.id = $4) END)
       ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [uuidv7(), reporter, type, id, owner, reason, note || null],
    );
    // Responde sempre o mesmo, mesmo que já tenha denunciado: não é preciso insistir.
  }

  /** Fila de denúncias abertas, agrupadas por conteúdo (quantas pessoas denunciaram e porquê). */
  async queue(status: 'open' | 'dismissed' | 'actioned' = 'open') {
    const { rows } = await this.pool.query(
      `SELECT r.target_type, r.target_id, count(*)::int AS reports, array_agg(DISTINCT r.reason) AS reasons,
              min(r.created_at) AS first_at, min(r.id::text) AS report_id,
              tu.username AS owner_username, tu.display_name AS owner_name, tu.status AS owner_status,
              (SELECT count(*) FROM social.reports x WHERE x.target_user_id = r.target_user_id AND x.status = 'actioned')::int AS owner_strikes,
              COALESCE(p.body, c.body, s.caption, max(m.body), CASE WHEN r.target_type = 'media' THEN max(r.note) END, '') AS preview,
              ${EVIDENCE_COLUMNS}
         FROM social.reports r
         LEFT JOIN identity.users tu ON tu.id = r.target_user_id
         LEFT JOIN content.posts p ON r.target_type = 'post' AND p.id = r.target_id
         LEFT JOIN content.comments c ON r.target_type = 'comment' AND c.id = r.target_id
         LEFT JOIN content.stories s ON r.target_type = 'story' AND s.id = r.target_id
         LEFT JOIN social.messages m ON r.target_type = 'message' AND m.id = r.target_id
        WHERE r.status = $1
        GROUP BY r.target_type, r.target_id, r.target_user_id, tu.username, tu.display_name, tu.status, p.body, c.body, s.caption
        ORDER BY count(*) DESC, min(r.created_at) ASC LIMIT 100`,
      [status],
    );
    return rows.map((r) => {
      // Mensagens: o que foi denunciado (a cópia) e, se mudou depois (editada ou apagada), também como está agora.
      const proof = messageProof(r);
      return {
        type: r.target_type as ReportType,
        id: r.target_id as string,
        reports: r.reports as number,
        reasons: r.reasons as ReportReason[],
        firstAt: r.first_at as string,
        owner: r.owner_username ? { username: r.owner_username as string, displayName: r.owner_name as string, status: r.owner_status as string, strikes: r.owner_strikes as number } : null,
        preview: (proof.reported ? proof.reported.body : (r.preview as string)).slice(0, 200),
        imageUrl: r.target_type === 'media' ? `/api/v1/media/review/${r.target_id}` : null,
        reported: proof.reported,
        current: proof.current,
      };
    });
  }

  /**
   * Decide sobre um conteúdo denunciado: ignorar, remover o conteúdo, ou suspender a conta do dono.
   * Fica registado no audit_log e todas as denúncias abertas desse conteúdo fecham juntas.
   */
  async resolve(admin: string, type: ReportType, id: string, action: 'dismiss' | 'remove' | 'suspend', note?: string) {
    const open = await this.pool.query(`SELECT target_user_id FROM social.reports WHERE target_type = $1 AND target_id = $2 AND status = 'open' LIMIT 1`, [type, id]);
    if (!open.rows[0]) throw new NotFoundException('Sem denúncias abertas para este conteúdo');
    const owner = open.rows[0].target_user_id as string | null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (action === 'remove') await removeReported(client, type, id, admin, note);
      if (action === 'suspend') {
        if (!owner) throw new BadRequestException('Conta desconhecida');
        const isAdminTarget = await client.query('SELECT is_admin FROM identity.users WHERE id = $1', [owner]);
        if (isAdminTarget.rows[0]?.is_admin) throw new ForbiddenException('Não se suspende uma conta de moderação');
        await client.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1 AND status = 'active'`, [owner]);
        await client.query('UPDATE identity.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [owner]);
      }
      await client.query(
        `UPDATE social.reports SET status = $3, resolution = $4, resolved_by = $5, resolved_at = now(), resolution_note = $6
          WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
        [type, id, action === 'dismiss' ? 'dismissed' : 'actioned', action, admin, note?.trim() || null],
      );
      await client.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
        uuidv7(), admin, `moderation.${action}`, `${type}:${id}`, { owner, note: note?.trim() || undefined },
      ]);
      await client.query('COMMIT');
      if (action === 'remove' && type === 'post') this.indexer.postRemoved(id);
      if (action === 'suspend' && owner) this.indexer.userRemoved(owner);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

/**
 * Remove um conteúdo denunciado, numa transação já aberta. Publicações, comentários e mimos removem-se de forma a poderem
 * ser repostos na página «Conteúdo» (content-removal.ts); se já estavam removidos (ou o autor já os apagou), só se fecham
 * as denúncias. Mensagens: o mesmo que "Apagar para todos", sem deixar o aviso no lugar (a cópia da denúncia fica, para a
 * moderação). Fotos assinaladas pela verificação automática: apagam-se. Contas e locais não se removem aqui.
 */
export async function removeReported(client: PoolClient, type: ReportType, id: string, actor: string, note?: string) {
  if (type === 'message') {
    const m = await client.query('SELECT 1 FROM social.messages WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (m.rowCount) await wipeMessage(client, id, false);
    return;
  }
  if (type === 'media') {
    await client.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [id]);
    return;
  }
  if (type === 'post' || type === 'comment' || type === 'story') {
    const reason = note?.trim() && note.trim().length >= 3 ? note.trim().slice(0, 300) : 'Decisão na fila de queixas';
    await client.query('SAVEPOINT remove_reported');
    try {
      await removeContent(client, type, id, actor, reason);
    } catch (e) {
      if (!(e instanceof NotFoundException)) throw e;
      await client.query('ROLLBACK TO SAVEPOINT remove_reported');
    }
    return;
  }
  throw new BadRequestException(type === 'venue' ? 'Os locais decidem-se em Locais' : 'Contas não se removem: suspende-se');
}
