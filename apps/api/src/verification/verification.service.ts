import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { syncPaidVerification } from '../iap/paid-verification';

import type { VerifiedTier } from '../common/badge';
export type { VerifiedTier } from '../common/badge';

/** Requisitos automáticos para poder pedir o selo (o primeiro filtro do processo híbrido). */
export const REQUIREMENTS = { minAgeDays: 30, minPosts: 3, minFollowers: 10, sanctionDays: 90, retryDays: 30 } as const;

@Injectable()
export class VerificationService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** O que a conta já cumpre e o que falta, com uma frase simples para cada ponto. */
  async checklist(userId: string) {
    const r = (
      await this.pool.query(
        `SELECT u.verified, u.verified_tier, u.email_verified_at IS NOT NULL AS email_ok, u.avatar_media_id IS NOT NULL AS has_avatar,
                coalesce(char_length(btrim(u.bio)), 0) > 0 AS has_bio, floor(extract(epoch FROM now() - u.created_at) / 86400)::int AS days,
                (SELECT count(*) FROM content.posts p WHERE p.author_id = u.id AND p.kind = 'post' AND p.removed_at IS NULL)::int AS posts,
                (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers,
                EXISTS (SELECT 1 FROM social.reports rp WHERE rp.target_user_id = u.id AND rp.status = 'actioned' AND rp.resolved_at > now() - make_interval(days => $2)) AS sanctioned
           FROM identity.users u WHERE u.id = $1`,
        [userId, REQUIREMENTS.sanctionDays],
      )
    ).rows[0];
    if (!r) throw new NotFoundException();
    const days = r.days as number;
    const items = [
      { key: 'email', label: 'Email confirmado', ok: r.email_ok as boolean, hint: 'Confirma o teu email nas Definições.' },
      { key: 'profile', label: 'Foto e bio no perfil', ok: (r.has_avatar && r.has_bio) as boolean, hint: 'Põe uma foto e escreve uma bio em Editar perfil.' },
      { key: 'age', label: `Conta com ${REQUIREMENTS.minAgeDays} dias ou mais`, ok: days >= REQUIREMENTS.minAgeDays, hint: `Tens ${days} dia${days === 1 ? '' : 's'}.` },
      { key: 'posts', label: `${REQUIREMENTS.minPosts} publicações ou mais`, ok: r.posts >= REQUIREMENTS.minPosts, hint: `Tens ${r.posts}.` },
      { key: 'followers', label: `${REQUIREMENTS.minFollowers} seguidores ou mais`, ok: r.followers >= REQUIREMENTS.minFollowers, hint: `Tens ${r.followers}.` },
      { key: 'conduct', label: 'Sem sanções recentes', ok: !r.sanctioned, hint: `Houve uma sanção nos últimos ${REQUIREMENTS.sanctionDays} dias.` },
    ];
    return { items, eligible: items.every((i) => i.ok), verified: r.verified as boolean, tier: (r.verified_tier as VerifiedTier | null) ?? null };
  }

  async status(userId: string) {
    const c = await this.checklist(userId);
    const last = (
      await this.pool.query(
        `SELECT id, kind, status, reason, created_at, reviewed_at FROM identity.verification_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId],
      )
    ).rows[0];
    const retryAfter =
      last?.status === 'rejected' && last.reviewed_at && Date.now() - new Date(last.reviewed_at).getTime() < REQUIREMENTS.retryDays * 86_400_000
        ? new Date(new Date(last.reviewed_at).getTime() + REQUIREMENTS.retryDays * 86_400_000).toISOString()
        : null;
    // Aprovado pela equipa para a verificação paga: pode subscrever na loja (GET /iap/catalog).
    const pv = (await this.pool.query('SELECT eligible_at FROM payments.paid_verification WHERE user_id = $1', [userId])).rows[0];
    return {
      ...c,
      paidEligible: !!pv?.eligible_at,
      request: last ? { id: last.id as string, kind: last.kind as string, status: last.status as string, reason: (last.reason as string | null) ?? null, createdAt: last.created_at as string } : null,
      retryAfter,
    };
  }

  private async ownedDoc(userId: string, id: string) {
    const r = await this.pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND owner_id = $2 AND purpose = 'chat' AND status = 'ready' AND mime LIKE 'image/%'`, [id, userId]);
    if (!r.rowCount) throw new BadRequestException('Documento inválido: envia uma foto (JPEG, PNG ou WebP)');
  }

  async request(userId: string, b: { kind: 'person' | 'business'; fullName: string; proof: string; docType: string; docMediaId: string; docBackMediaId?: string; faceMediaId: string; selfieMediaId: string }) {
    const s = await this.status(userId);
    if (s.verified) throw new ConflictException('Esta conta já está verificada');
    if (s.request?.status === 'pending') throw new ConflictException('Já tens um pedido em análise');
    if (s.request?.status === 'paid_eligible') throw new ConflictException('A tua identidade já foi aprovada: podes subscrever a verificação paga');
    if (s.retryAfter) throw new ConflictException('Podes pedir outra vez passados 30 dias do último pedido recusado');
    if (!s.eligible) throw new ForbiddenException('A conta ainda não cumpre os requisitos');
    // O passaporte tem uma página com a foto; os outros documentos têm frente e verso.
    if (b.docType !== 'passport' && !b.docBackMediaId) throw new BadRequestException('Envia a frente e o verso do documento');
    const photos = [b.docMediaId, b.docBackMediaId, b.faceMediaId, b.selfieMediaId].filter((x): x is string => !!x);
    if (new Set(photos).size !== photos.length) throw new BadRequestException('Cada foto tem de ser diferente das outras');
    for (const id of photos) await this.ownedDoc(userId, id);
    await this.pool.query(
      `INSERT INTO identity.verification_requests (id, user_id, kind, full_name, proof, doc_type, doc_media_id, doc_back_media_id, face_media_id, selfie_media_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [uuidv7(), userId, b.kind, b.fullName.trim(), b.proof.trim(), b.docType, b.docMediaId, b.docBackMediaId ?? null, b.faceMediaId, b.selfieMediaId],
    );
  }

  /** Retirar o pedido: os documentos apagam-se. */
  async withdraw(userId: string) {
    const r = await this.pool.query(
      `UPDATE identity.verification_requests SET status = 'withdrawn', reviewed_at = now() WHERE user_id = $1 AND status = 'pending' RETURNING doc_media_id, doc_back_media_id, face_media_id, selfie_media_id`,
      [userId],
    );
    if (!r.rowCount) throw new NotFoundException('Não tens nenhum pedido em análise');
    await this.dropDocs([r.rows[0].doc_media_id, r.rows[0].doc_back_media_id, r.rows[0].face_media_id, r.rows[0].selfie_media_id]);
  }

  private async dropDocs(ids: (string | null)[]) {
    const list = ids.filter((x): x is string => !!x);
    if (list.length) await this.pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = ANY($1)`, [list]);
  }

  /** Fila de revisão (só moderação). Os documentos vêm com ligações privadas que expiram. */
  async queue(status: 'pending' | 'approved' | 'rejected' | 'paid_eligible' = 'pending') {
    const { rows } = await this.pool.query(
      `SELECT v.id, v.kind, v.full_name, v.proof, v.status, v.reason, v.created_at, v.doc_type, v.doc_media_id, v.doc_back_media_id, v.face_media_id, v.selfie_media_id,
              u.username, u.display_name, u.bio, (u.avatar_media_id IS NOT NULL) AS has_avatar,
              (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers
         FROM identity.verification_requests v JOIN identity.users u ON u.id = v.user_id
        WHERE v.status = $1 ORDER BY v.created_at ASC LIMIT 100`,
      [status],
    );
    return rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      fullName: r.full_name as string,
      proof: r.proof as string,
      status: r.status as string,
      reason: (r.reason as string | null) ?? null,
      createdAt: r.created_at as string,
      user: { username: r.username as string, displayName: r.display_name as string, bio: (r.bio as string | null) ?? '', hasAvatar: r.has_avatar as boolean, followers: r.followers as number },
      docType: (r.doc_type as string | null) ?? null,
      docUrl: r.doc_media_id ? this.media.chatUrl(r.doc_media_id as string) : null,
      docBackUrl: r.doc_back_media_id ? this.media.chatUrl(r.doc_back_media_id as string) : null,
      faceUrl: r.face_media_id ? this.media.chatUrl(r.face_media_id as string) : null,
      selfieUrl: r.selfie_media_id ? this.media.chatUrl(r.selfie_media_id as string) : null,
    }));
  }

  /**
   * Aprovar, recusar ou aprovar como «elegível para verificação paga» ('approve_paid'). Em qualquer caso os documentos são
   * apagados. Ao aprovar, a conta recebe o selo e é anunciada. Com 'approve_paid' a identidade fica confirmada, mas o selo
   * só aparece com a subscrição da verificação paga ativa (compras pela loja, nível 'paid'); se a pessoa já tiver uma
   * subscrição guardada, o selo é aplicado logo.
   */
  async decide(adminId: string, id: string, action: 'approve' | 'reject' | 'approve_paid', reason?: string, tier: VerifiedTier = 'verified') {
    if (action === 'reject' && !reason?.trim()) throw new BadRequestException('Diz o motivo da recusa');
    const client = await this.pool.connect();
    let req: { user_id: string; doc_media_id: string | null; doc_back_media_id: string | null; face_media_id: string | null; selfie_media_id: string | null } | undefined;
    try {
      await client.query('BEGIN');
      req = (
        await client.query(
          `UPDATE identity.verification_requests SET status = $2, reason = $3, reviewed_by = $4, reviewed_at = now()
            WHERE id = $1 AND status = 'pending' RETURNING user_id, doc_media_id, doc_back_media_id, face_media_id, selfie_media_id`,
          [id, action === 'approve' ? 'approved' : action === 'approve_paid' ? 'paid_eligible' : 'rejected', action === 'reject' ? reason!.trim().slice(0, 300) : null, adminId],
        )
      ).rows[0];
      if (!req) throw new NotFoundException('Pedido não encontrado ou já decidido');
      if (action === 'approve') await client.query(`UPDATE identity.users SET verified = true, verified_at = now(), verified_tier = $2 WHERE id = $1`, [req.user_id, tier]);
      if (action === 'approve_paid') {
        await client.query(
          `INSERT INTO payments.paid_verification (user_id, eligible_at, eligible_by, request_id) VALUES ($1, now(), $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET eligible_at = now(), eligible_by = $2, request_id = $3, updated_at = now()`,
          [req.user_id, adminId, id],
        );
        await syncPaidVerification(client, req.user_id);
      }
      // Fica no registo, na ficha da conta (Histórico), como as outras ações da equipa.
      await client.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
        uuidv7(), adminId, action === 'approve' ? 'verification.approve' : action === 'approve_paid' ? 'verification.approve_paid' : 'verification.reject', `user:${req.user_id}`,
        action === 'approve' ? { request: id, tier } : action === 'approve_paid' ? { request: id } : { request: id, reason: reason!.trim().slice(0, 300) },
      ]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await this.dropDocs([req.doc_media_id, req.doc_back_media_id, req.face_media_id, req.selfie_media_id]);
    if (action === 'approve') await this.announce(req.user_id);
  }

  /** O anúncio: a própria pessoa vê o aviso e quem a segue é avisado de que a conta foi verificada. */
  private async announce(userId: string) {
    await this.pool.query(`INSERT INTO social.notifications (id, user_id, actor_id, kind, data) VALUES ($1, $2, $2, 'verified', '{}')`, [uuidv7(), userId]);
    const { rows } = await this.pool.query(`SELECT follower_id FROM social.follows WHERE followee_id = $1 ORDER BY created_at DESC LIMIT 500`, [userId]);
    for (const r of rows) await this.notifications.notify({ userId: r.follower_id as string, actorId: userId, kind: 'verified' });
  }
}
