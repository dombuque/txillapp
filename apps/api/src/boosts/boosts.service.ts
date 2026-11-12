import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { IAP_DRAFT_HOURS, iapBoostRadius, iapProducts } from '../iap/iap-config';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { eventEnd } from '../nearby/events.service';
import { distKm, inBox } from '../nearby/geo-sql';
import { blockedBetween } from '../social/visibility';
import { ISSUANCE_ACCOUNT, WalletService } from '../wallet/wallet.service';
import {
  BOOST_PACKAGES, BOOST_PAYMENTS, BOOST_PAYMENT_IDS, BOOST_RADIUS, DAY_MS, EVENT_GRACE_HOURS, FEED_CAP_PER_DAY, FEED_FIRST_SLOT,
  MAP_VIEW_GAP_MINUTES, MAX_START_DAYS_AHEAD, SPONSORED_LABEL, boostPackage, boostPrice, boostRefund, feedSlotPositions,
  type BoostPackageId, type BoostPayment,
} from './boost-config';

export interface BoostCreateInput {
  target: { kind: 'event' | 'post'; id: string };
  package: BoostPackageId;
  radiusKm: number;
  /** ISO; por omissão agora. */
  startsAt?: string;
  payment?: BoostPayment;
}

/** A posição de quem vê, JÁ arredondada (~1 km). Só vive dentro do pedido: nunca se guarda. */
export interface BoostCenter {
  lat: number;
  lng: number;
}

/** Um destaque do feed, já com a publicação ou o evento (como o feed e a página do evento os mostram). */
export interface SponsoredSlot<P = unknown, E = unknown> {
  campaignId: string;
  /** Mostra-se depois desta publicação da página (null: no início, numa página vazia). */
  afterId: string | null;
  label: string;
  kind: 'post' | 'event';
  venue: { slug: string; name: string; avatarUrl: string | null; verified: boolean };
  post: P | null;
  event: E | null;
}

/** Um destaque no mapa do "À tua volta": o evento (campanha de evento) ou o pino do local (campanha de publicação). */
export interface MapBoost {
  campaignId: string;
  venueId: string;
  venueSlug: string;
  eventId: string | null;
  kind: 'post' | 'event';
}

type Row = Record<string, any>;

const media = (id: unknown) => (id ? `/api/v1/media/${id as string}` : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quem vê: 18 anos ou mais, com data de nascimento (sem ela conta como menor). Os locais são bares e discotecas. */
const ADULT_VIEWER = `(me.birth_date IS NOT NULL AND me.birth_date <= (current_date - interval '18 years'))`;
/** O fim efetivo de uma campanha (parada ou suspensa antes do fim). */
const EFFECTIVE_END = `LEAST(c.ends_at, COALESCE(c.stopped_at, c.ends_at))`;

/**
 * Bombar: o dono e os administradores de um local pagam com os Txills da carteira do local para destacar um evento do
 * local ou uma publicação feita como o local, num raio de 1 a 10 km à volta do local.
 *
 * - Aprovação: automática quando o local já está aprovado pela equipa (e com "Mostrar no mapa" ligado). A equipa pode
 *   suspender (com ou sem devolução) e repor. Tudo fica no registo de auditoria.
 * - Entrega: feed (no máximo 1 a cada ~11 publicações, 3 vezes por dia por pessoa) e mapa (pino realçado, no topo).
 *   Só a quem está dentro do raio (posição aproximada ou cidade escolhida, nunca guardadas), adultos com data de
 *   nascimento, sem bloqueio com o dono, que não escondeu os destaques do local e que não gere o local.
 * - Relatório: só totais (impressões, pessoas, toques, "Tenho interesse", check-ins). Nunca quem viu.
 */
@Injectable()
export class BoostsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly wallet: WalletService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /* ───────────── local: opções, criar, ver, parar ───────────── */

  /** O local, se a pessoa é o dono ou um administrador (os editores não bombam). */
  private async managed(userId: string, slug: string) {
    const v = (await this.pool.query(
      `SELECT v.id, v.slug, v.name, v.owner_id, v.review_status, v.show_on_map, v.lat, v.lng,
              CASE WHEN v.owner_id = $2 THEN 'owner' ELSE (SELECT m.role FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $2 AND m.status = 'active') END AS role,
              (SELECT a.balance FROM ledger.accounts a WHERE a.venue_id = v.id) AS balance
         FROM content.venues v JOIN identity.users ou ON ou.id = v.owner_id AND ou.status <> 'deleted'
        WHERE v.slug = $1`,
      [slug.toLowerCase(), userId],
    )).rows[0];
    if (!v) throw new NotFoundException('Local não encontrado');
    if (v.role !== 'owner' && v.role !== 'admin') throw new ForbiddenException('Só o dono e os administradores podem bombar este local');
    return v as { id: string; slug: string; name: string; owner_id: string; review_status: string; show_on_map: boolean; lat: number | null; lng: number | null; role: string; balance: string | null };
  }

  /** Porque é que este local ainda não pode bombar (null: pode). */
  private blocker(v: { review_status: string; show_on_map: boolean; lat: number | null; lng: number | null }): string | null {
    if (v.review_status !== 'approved') return 'O local ainda não foi aprovado pela equipa do Txillapp. Depois de aprovado, já podes bombar.';
    if (!v.show_on_map) return 'Liga "Mostrar no mapa" no perfil do local para bombar: os destaques mostram-se a quem está perto.';
    if (v.lat == null || v.lng == null) return 'Marca no mapa onde fica o local para bombar: os destaques mostram-se à volta dele.';
    return null;
  }

  /** O que o ecrã "Bombar" precisa: pacotes e preços por raio, pagamentos, saldo e o que se pode bombar. */
  async options(userId: string, slug: string) {
    const v = await this.managed(userId, slug);
    const [events, posts] = await Promise.all([
      this.pool.query(
        `SELECT e.id, e.title, e.starts_at, e.ends_at FROM content.venue_events e
          WHERE e.venue_id = $1 AND e.cancelled_at IS NULL AND ${eventEnd('e')} > now() ORDER BY e.starts_at, e.id LIMIT 30`,
        [v.id],
      ),
      this.pool.query(
        `SELECT p.id, p.short_code, p.body, p.created_at, fm.media_id, (fm.mime LIKE 'video/%') AS is_video
           FROM content.posts p
           LEFT JOIN LATERAL (SELECT pm.media_id, ma.mime FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id
                               WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) fm ON true
          WHERE p.venue_id = $1 AND p.removed_at IS NULL AND p.kind = 'post' ORDER BY p.created_at DESC LIMIT 20`,
        [v.id],
      ),
    ]);
    const radii = Array.from({ length: BOOST_RADIUS.max - BOOST_RADIUS.min + 1 }, (_, i) => BOOST_RADIUS.min + i);
    const blocker = this.blocker(v);
    return {
      canBoost: !blocker,
      blocker,
      balance: Number(v.balance ?? 0),
      label: SPONSORED_LABEL,
      payments: BOOST_PAYMENT_IDS.map((id) => ({ id, label: BOOST_PAYMENTS[id].label, enabled: BOOST_PAYMENTS[id].enabled })),
      radius: BOOST_RADIUS,
      packages: BOOST_PACKAGES.map((p) => ({ id: p.id, days: p.days, label: p.label, basePrice: p.price, prices: Object.fromEntries(radii.map((r) => [r, boostPrice(p, r)])) as Record<number, number> })),
      targets: {
        events: events.rows.map((r) => ({ id: r.id as string, title: r.title as string, startsAt: new Date(r.starts_at as string).toISOString(), endsAt: r.ends_at ? new Date(r.ends_at as string).toISOString() : null })),
        posts: posts.rows.map((r) => ({
          id: r.id as string, code: r.short_code as string, body: String(r.body ?? '').slice(0, 140), createdAt: new Date(r.created_at as string).toISOString(),
          thumbUrl: r.media_id ? `/api/v1/media/${r.media_id as string}${r.is_video ? '?poster=1' : ''}` : null,
        })),
      },
    };
  }

  /** Criar uma campanha: debita a carteira do local (idempotente pela chave) e fica logo ativa (aprovação automática). */
  async create(userId: string, slug: string, b: BoostCreateInput, key: string) {
    const v = await this.managed(userId, slug);
    const why = this.blocker(v);
    if (why) throw new UnprocessableEntityException(why);
    const payment: BoostPayment = b.payment ?? 'txills';
    if (!BOOST_PAYMENTS[payment]?.enabled) throw new UnprocessableEntityException('O pagamento em meticais ainda não está disponível. Por agora paga-se com os Txills do local.');
    const pkg = boostPackage(b.package);
    if (!pkg) throw new BadRequestException('Pacote inválido');
    const radius = Math.round(b.radiusKm);
    if (!Number.isFinite(radius) || radius < BOOST_RADIUS.min || radius > BOOST_RADIUS.max) throw new BadRequestException(`O raio vai de ${BOOST_RADIUS.min} a ${BOOST_RADIUS.max} km`);
    const { startsAt, endsAt } = await this.schedule(v.id, b, pkg.days);
    const price = boostPrice(pkg, radius);

    const account = await this.wallet.ensureVenueWallet(v.id);
    const idem = `boost:${v.id}:${key}`;
    const c = await this.pool.connect();
    let id = uuidv7();
    let replayed = false;
    try {
      await c.query('BEGIN');
      const dup = (await c.query('SELECT id FROM ledger.transactions WHERE actor_id = $1 AND idempotency_key = $2', [userId, idem])).rows[0];
      if (dup) {
        replayed = true;
        id = (await c.query('SELECT id FROM content.boost_campaigns WHERE charge_tx_id = $1', [dup.id])).rows[0]?.id as string;
        await c.query('COMMIT');
      } else {
        await c.query('SELECT 1 FROM ledger.accounts WHERE id = $1 FOR UPDATE', [account]);
        const target = { kind: b.target.kind, id: b.target.id };
        const txId = await this.wallet.postIn(c, {
          type: 'boost', actorId: userId, key: idem,
          legs: [[account, -price], [ISSUANCE_ACCOUNT, price]],
          metadata: { venueId: v.id, venueName: v.name, campaignId: id, package: pkg.id, radiusKm: radius, target, payment },
        });
        await c.query(
          `INSERT INTO content.boost_campaigns (id, venue_id, target_kind, event_id, post_id, package, days, radius_km, starts_at, ends_at, payment, price, status, review, charge_tx_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', 'auto', $13, $14)`,
          [id, v.id, target.kind, target.kind === 'event' ? target.id : null, target.kind === 'post' ? target.id : null, pkg.id, pkg.days, radius, startsAt, endsAt, payment, price, txId, userId],
        );
        await c.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
          uuidv7(), userId, 'boost.created', `boost:${id}`,
          { venueId: v.id, slug: v.slug, target, package: pkg.id, radiusKm: radius, price, payment, review: 'auto', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        ]);
        await c.query('COMMIT');
      }
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      const code = (e as { code?: string }).code;
      if (code === '23514') throw new UnprocessableEntityException(`O local não tem Txills suficientes: este pacote custa ${price} Txills.`);
      if (code === '23505') {
        // Dois pedidos com a mesma chave ao mesmo tempo: devolve a campanha do vencedor.
        const tx = (await this.pool.query('SELECT id FROM ledger.transactions WHERE actor_id = $1 AND idempotency_key = $2', [userId, idem])).rows[0];
        const won = tx ? (await this.pool.query('SELECT id FROM content.boost_campaigns WHERE charge_tx_id = $1', [tx.id])).rows[0] : null;
        if (!won) throw e;
        id = won.id as string;
        replayed = true;
      } else throw e;
    } finally {
      c.release();
    }
    const balance = Number((await this.pool.query('SELECT balance FROM ledger.accounts WHERE id = $1', [account])).rows[0].balance);
    return { campaign: await this.campaign(id), balance, replayed };
  }

  /** O início e o fim da campanha, e se o alvo (evento ou publicação do local) ainda serve para essas datas. */
  private async schedule(venueId: string, b: { target: { kind: 'event' | 'post'; id: string }; startsAt?: string }, days: number) {
    const now = Date.now();
    const asked = b.startsAt ? new Date(b.startsAt) : new Date(now);
    if (Number.isNaN(asked.getTime())) throw new BadRequestException('Data de início inválida');
    if (asked.getTime() < now - 10 * 60_000) throw new BadRequestException('O início não pode ser no passado');
    if (asked.getTime() > now + MAX_START_DAYS_AHEAD * DAY_MS) throw new BadRequestException(`Só dá para agendar até ${MAX_START_DAYS_AHEAD} dias à frente`);
    const startsAt = new Date(Math.max(asked.getTime(), now));
    const endsAt = new Date(startsAt.getTime() + days * DAY_MS);

    if (!UUID.test(b.target.id)) throw new NotFoundException(b.target.kind === 'event' ? 'Evento não encontrado' : 'Publicação não encontrada');
    if (b.target.kind === 'event') {
      const e = (await this.pool.query(`SELECT e.id, e.cancelled_at, ${eventEnd('e')} AS ends FROM content.venue_events e WHERE e.id = $1 AND e.venue_id = $2`, [b.target.id, venueId])).rows[0];
      if (!e) throw new NotFoundException('Evento não encontrado neste local');
      if (e.cancelled_at) throw new UnprocessableEntityException('Este evento foi cancelado');
      const ends = new Date(e.ends as string).getTime();
      if (ends <= now || startsAt.getTime() >= ends) throw new UnprocessableEntityException('Este evento já terá acabado quando a campanha começar');
      if (endsAt.getTime() > ends + EVENT_GRACE_HOURS * 3_600_000) throw new UnprocessableEntityException('O evento acaba antes da campanha: escolhe um pacote mais curto.');
    } else {
      const p = (await this.pool.query(`SELECT 1 FROM content.posts p WHERE p.id = $1 AND p.venue_id = $2 AND p.removed_at IS NULL AND p.kind = 'post'`, [b.target.id, venueId])).rowCount;
      if (!p) throw new NotFoundException('Publicação do local não encontrada');
    }
    return { startsAt, endsAt };
  }

  /* ───────────── Bombar pago na loja (App Store / Google Play) ───────────── */

  /**
   * Compra pela loja, passo 1: a campanha fica em rascunho ('draft'), sem custar Txills e sem aparecer a ninguém. O raio
   * é o fixo do pacote (IAP_BOOST_RADIUS_KM). Com a mesma chave, devolve o mesmo rascunho.
   * Passo 2: a app compra o produto do pacote na loja e manda a compra a POST /iap/…/verify com o `campaignId`.
   * Só com as compras pela loja ligadas (IAP_ENABLED). `pack`, se vier, tem de ser o produto da loja deste pacote. Os
   * rascunhos por pagar apagam-se passadas IAP_DRAFT_HOURS (24 h) e nunca aparecem no feed nem no mapa.
   */
  async createIapDraft(userId: string, slug: string, b: Omit<BoostCreateInput, 'radiusKm' | 'payment'> & { pack?: string }, key: string | null) {
    if (!this.cfg.IAP_ENABLED) throw new ServiceUnavailableException('As compras pela loja não estão disponíveis');
    const v = await this.managed(userId, slug);
    const why = this.blocker(v);
    if (why) throw new UnprocessableEntityException(why);
    const pkg = boostPackage(b.package);
    if (!pkg) throw new BadRequestException('Pacote inválido');
    if (b.pack !== undefined && iapProducts(this.cfg).boost.find((p) => p.package === pkg.id)?.id !== b.pack) throw new UnprocessableEntityException('O produto da loja não é o deste pacote');
    if (key !== null && (key.length < 8 || key.length > 100)) throw new BadRequestException('A chave de idempotência tem 8 a 100 caracteres');
    await this.expireIapDrafts();
    const radius = iapBoostRadius(this.cfg)[pkg.id];
    if (key) {
      const dup = (await this.pool.query(`SELECT id FROM content.boost_campaigns WHERE venue_id = $1 AND created_by = $2 AND draft_key = $3`, [v.id, userId, key])).rows[0];
      if (dup) return { campaign: await this.campaign(dup.id as string), balance: Number(v.balance ?? 0), replayed: true };
    }
    const { startsAt, endsAt } = await this.schedule(v.id, b, pkg.days);
    const id = uuidv7();
    const target = { kind: b.target.kind, id: b.target.id };
    const ins = await this.pool.query(
      `INSERT INTO content.boost_campaigns (id, venue_id, target_kind, event_id, post_id, package, days, radius_km, starts_at, ends_at, payment, price, status, review, created_by, draft_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'iap', 0, 'draft', 'auto', $11, $12)
       ON CONFLICT (venue_id, created_by, draft_key) WHERE draft_key IS NOT NULL DO NOTHING RETURNING id`,
      [id, v.id, target.kind, target.kind === 'event' ? target.id : null, target.kind === 'post' ? target.id : null, pkg.id, pkg.days, radius, startsAt, endsAt, userId, key],
    );
    if (!ins.rowCount) {
      const won = (await this.pool.query(`SELECT id FROM content.boost_campaigns WHERE venue_id = $1 AND created_by = $2 AND draft_key = $3`, [v.id, userId, key])).rows[0];
      return { campaign: await this.campaign(won.id as string), balance: Number(v.balance ?? 0), replayed: true };
    }
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
      uuidv7(), userId, 'boost.draft_created', `boost:${id}`, { venueId: v.id, slug: v.slug, target, package: pkg.id, radiusKm: radius, payment: 'iap' },
    ]);
    return { campaign: await this.campaign(id), balance: Number(v.balance ?? 0), replayed: false };
  }

  /**
   * Compra pela loja, verificada: liga a campanha em rascunho e ativa-a já (começa agora, ou na data agendada se ainda
   * não passou). Corre na transação de quem regista a compra. Só o dono ou um administrador do local, e só um rascunho
   * do mesmo pacote que se comprou.
   */
  async activateIap(c: PoolClient, campaignId: string, userId: string, pkg: BoostPackageId, purchase: { id: string; store: string; productId: string }) {
    if (!UUID.test(campaignId)) throw new NotFoundException('Campanha não encontrada');
    const r = (await c.query('SELECT * FROM content.boost_campaigns WHERE id = $1 FOR UPDATE', [campaignId])).rows[0];
    if (!r) throw new NotFoundException('Campanha não encontrada');
    const role = (await c.query(
      `SELECT CASE WHEN v.owner_id = $2 THEN 'owner' ELSE (SELECT m.role FROM content.venue_managers m WHERE m.venue_id = v.id AND m.user_id = $2 AND m.status = 'active') END AS role
         FROM content.venues v WHERE v.id = $1`,
      [r.venue_id, userId],
    )).rows[0]?.role as string | undefined;
    if (role !== 'owner' && role !== 'admin') throw new ForbiddenException('Só o dono e os administradores podem bombar este local');
    if (r.status !== 'draft' || r.payment !== 'iap') throw new ConflictException('Esta campanha já não está à espera de pagamento');
    if (r.package !== pkg) throw new UnprocessableEntityException('O pacote comprado não é o desta campanha');
    const now = Date.now();
    const starts = new Date(Math.max(now, new Date(r.starts_at as string).getTime()));
    const ends = new Date(starts.getTime() + Number(r.days) * DAY_MS);
    await c.query(`UPDATE content.boost_campaigns SET status = 'active', starts_at = $2, ends_at = $3, draft_key = NULL WHERE id = $1`, [campaignId, starts, ends]);
    await c.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
      uuidv7(), userId, 'boost.created', `boost:${campaignId}`,
      { venueId: r.venue_id, package: pkg, radiusKm: Number(r.radius_km), price: 0, payment: 'iap', store: purchase.store, productId: purchase.productId, purchaseId: purchase.id, review: 'auto', startsAt: starts.toISOString(), endsAt: ends.toISOString() },
    ]);
  }

  /** A compra da campanha foi reembolsada (ou revogada) na loja: a campanha é suspensa (sem Txills a devolver: não os gastou). */
  async suspendIap(c: PoolClient, campaignId: string, reason: 'refunded' | 'revoked') {
    const r = (await c.query(
      `UPDATE content.boost_campaigns SET status = 'suspended', stopped_at = now(), status_note = $2
        WHERE id = $1 AND payment = 'iap' AND status IN ('draft', 'pending', 'active') RETURNING venue_id`,
      [campaignId, reason === 'refunded' ? 'Compra reembolsada na loja' : 'Compra revogada na loja'],
    )).rows[0];
    if (!r) return false;
    await c.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
      uuidv7(), null, 'boost.iap_suspended', `boost:${campaignId}`, { venueId: r.venue_id, reason },
    ]);
    return true;
  }

  /** Apaga os rascunhos por pagar com mais de IAP_DRAFT_HOURS (nenhuma compra lhes ficou ligada). Devolve quantos. */
  async expireIapDrafts(): Promise<number> {
    const r = await this.pool.query(
      `DELETE FROM content.boost_campaigns c WHERE c.status = 'draft' AND c.payment = 'iap' AND c.created_at < now() - make_interval(hours => $1)
          AND NOT EXISTS (SELECT 1 FROM payments.iap_purchases ip WHERE ip.campaign_id = c.id)`,
      [IAP_DRAFT_HOURS],
    );
    return r.rowCount ?? 0;
  }

  /** A campanha existe (para saber se um rascunho já expirou)? */
  async campaignExists(id: string) {
    return UUID.test(id) && !!(await this.pool.query('SELECT 1 FROM content.boost_campaigns WHERE id = $1', [id])).rowCount;
  }

  /** O estado de uma campanha, para a resposta das compras. */
  async campaignState(id: string) {
    return (await this.campaign(id)).state;
  }

  /** As campanhas do local, com o relatório de cada uma: as ativas (e agendadas) e as passadas. */
  async list(userId: string, slug: string) {
    const v = await this.managed(userId, slug);
    const { rows } = await this.pool.query(`${this.CAMPAIGN_SELECT} WHERE c.venue_id = $1 ORDER BY c.created_at DESC LIMIT 60`, [v.id]);
    const items = rows.map((r) => this.dto(r));
    return {
      balance: Number(v.balance ?? 0),
      active: items.filter((i) => i.state === 'active' || i.state === 'scheduled' || i.state === 'pending'),
      past: items.filter((i) => i.state === 'ended' || i.state === 'stopped' || i.state === 'suspended'),
    };
  }

  /** O local para a campanha (o dono ou um administrador do local da campanha). */
  async stop(userId: string, id: string) {
    const c = await this.campaignVenue(id);
    await this.managed(userId, c.slug);
    return this.halt(id, userId, 'stopped', true, null);
  }

  private async campaignVenue(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Campanha não encontrada');
    const r = (await this.pool.query('SELECT c.id, v.slug FROM content.boost_campaigns c JOIN content.venues v ON v.id = c.venue_id WHERE c.id = $1', [id])).rows[0];
    if (!r) throw new NotFoundException('Campanha não encontrada');
    return r as { id: string; slug: string };
  }

  /**
   * Parar (o local) ou suspender (a equipa) uma campanha a decorrer ou agendada. Com `refund`, devolve à carteira do local
   * os dias inteiros que faltam (tudo, se ainda não tinha começado), no mesmo livro de partidas dobradas.
   */
  private async halt(id: string, actorId: string, status: 'stopped' | 'suspended', refund: boolean, note: string | null) {
    const c = await this.pool.connect();
    let amount = 0;
    try {
      await c.query('BEGIN');
      const r = (await c.query('SELECT * FROM content.boost_campaigns WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r) throw new NotFoundException('Campanha não encontrada');
      if (r.status !== 'active' && r.status !== 'pending') throw new ConflictException('Esta campanha já não está a decorrer');
      const now = new Date();
      if (now.getTime() >= new Date(r.ends_at as string).getTime()) throw new ConflictException('Esta campanha já terminou');
      // Pago na loja: não há Txills a devolver (o reembolso, se houver, é da loja).
      amount = refund && r.payment !== 'iap' ? boostRefund({ price: Number(r.price), days: Number(r.days), startsAt: new Date(r.starts_at as string), endsAt: new Date(r.ends_at as string) }, now) : 0;
      let refundTx: string | null = null;
      if (amount > 0) {
        const account = (await c.query('SELECT id FROM ledger.accounts WHERE venue_id = $1 FOR UPDATE', [r.venue_id])).rows[0]?.id as string | undefined;
        if (!account) throw new ConflictException('A carteira do local não existe');
        refundTx = await this.wallet.postIn(c, {
          type: 'boost_refund', actorId, key: `boost_refund:${id}`,
          legs: [[ISSUANCE_ACCOUNT, -amount], [account, amount]],
          metadata: { venueId: r.venue_id, campaignId: id, amount, reason: status },
        });
      }
      await c.query(
        'UPDATE content.boost_campaigns SET status = $2, stopped_at = $3, stopped_by = $4, refunded = $5, refund_tx_id = $6, status_note = $7 WHERE id = $1',
        [id, status, now, actorId, amount, refundTx, note],
      );
      await c.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
        uuidv7(), actorId, status === 'stopped' ? 'boost.stopped' : 'moderation.boost_suspended', `boost:${id}`, { venueId: r.venue_id, refunded: amount, note },
      ]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
    return { campaign: await this.campaign(id), refunded: amount };
  }

  /* ───────────── equipa (backoffice) ───────────── */

  /** Para a equipa: as campanhas a decorrer (ou todas), as mais recentes primeiro. */
  async adminList(filter: 'live' | 'all') {
    const { rows } = await this.pool.query(
      `${this.CAMPAIGN_SELECT} WHERE ($1 = 'all' AND c.status <> 'draft' OR (c.status IN ('active', 'pending') AND c.ends_at > now())) ORDER BY c.created_at DESC LIMIT 200`,
      [filter],
    );
    return rows.map((r) => ({ ...this.dto(r), venue: { slug: r.venue_slug as string, name: r.venue_name as string } }));
  }

  /** A equipa suspende uma campanha (por exemplo, conteúdo que viola as regras). Com `refund`, devolve os dias que faltam. */
  suspend(actorId: string, id: string, note: string | null, refund: boolean) {
    return this.halt(id, actorId, 'suspended', refund, note);
  }

  /** A equipa repõe uma campanha suspensa sem devolução (continua até ao fim que tinha). */
  async reinstate(actorId: string, id: string) {
    const r = await this.pool.query(
      `UPDATE content.boost_campaigns SET status = 'active', stopped_at = NULL, stopped_by = NULL, status_note = NULL
        WHERE id = $1 AND status = 'suspended' AND refunded = 0 AND ends_at > now()
          AND NOT EXISTS (SELECT 1 FROM payments.iap_purchases ip WHERE ip.campaign_id = $1 AND ip.status IN ('refunded', 'revoked')) RETURNING venue_id`,
      [id],
    );
    if (!r.rowCount) throw new ConflictException('Só se repõe uma campanha suspensa, sem devolução e que ainda não acabou');
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
      uuidv7(), actorId, 'moderation.boost_reinstated', `boost:${id}`, { venueId: r.rows[0].venue_id },
    ]);
    return { campaign: await this.campaign(id) };
  }

  /* ───────────── quem vê: toques e "não mostrar" ───────────── */

  /** Tocou no destaque (abriu o evento ou a publicação). Só conta a quem o destaque foi mostrado; repetidos em 10 s contam uma vez. */
  async tap(userId: string, id: string, surface: 'feed' | 'map') {
    if (!UUID.test(id)) throw new NotFoundException('Campanha não encontrada');
    const exists = (await this.pool.query('SELECT 1 FROM content.boost_campaigns WHERE id = $1', [id])).rowCount;
    if (!exists) throw new NotFoundException('Campanha não encontrada');
    await this.pool.query(
      `INSERT INTO content.boost_impressions (id, campaign_id, user_id, kind, surface)
       SELECT $1, $2, $3, 'tap', $4
        WHERE EXISTS (SELECT 1 FROM content.boost_impressions v WHERE v.campaign_id = $2 AND v.user_id = $3 AND v.kind = 'view')
          AND NOT EXISTS (SELECT 1 FROM content.boost_impressions t WHERE t.campaign_id = $2 AND t.user_id = $3 AND t.kind = 'tap' AND t.created_at > now() - interval '10 seconds')`,
      [uuidv7(), id, userId, surface],
    );
  }

  /** "Não mostrar destaques deste local": deixa de ver os destaques do local (no feed e no mapa). */
  async hideVenue(userId: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Campanha não encontrada');
    const r = await this.pool.query(
      `INSERT INTO content.boost_hidden (user_id, venue_id) SELECT $1, c.venue_id FROM content.boost_campaigns c WHERE c.id = $2 ON CONFLICT DO NOTHING`,
      [userId, id],
    );
    if (!r.rowCount && !(await this.pool.query('SELECT 1 FROM content.boost_campaigns WHERE id = $1', [id])).rowCount) throw new NotFoundException('Campanha não encontrada');
  }

  /* ───────────── entrega: feed e mapa ───────────── */

  /**
   * Campanhas que se podem mostrar a esta pessoa neste sítio. $1 = quem vê, $2/$3 = centro arredondado.
   * Regras: a decorrer, local aprovado e no mapa, dentro do raio, quem vê é adulto (com data de nascimento), sem bloqueio
   * com o dono, não escondeu os destaques do local, não gere o local, e o alvo ainda existe (evento por acabar e não
   * cancelado; publicação não apagada nem escondida por quem vê).
   */
  private eligible(extra = '') {
    return `
      SELECT c.id, c.target_kind, c.event_id, c.post_id, c.venue_id, v.slug AS venue_slug, v.name AS venue_name, v.avatar_media_id, v.verified
        FROM content.boost_campaigns c
        JOIN content.venues v ON v.id = c.venue_id
        JOIN identity.users ou ON ou.id = v.owner_id AND ou.status = 'active'
        JOIN identity.users me ON me.id = $1
       WHERE c.status = 'active' AND c.starts_at <= now() AND c.ends_at > now()
         AND v.review_status = 'approved' AND v.show_on_map AND v.lat IS NOT NULL AND v.lng IS NOT NULL
         AND ${ADULT_VIEWER}
         AND ${inBox('v.lat', 'v.lng', String(BOOST_RADIUS.max))} AND ${distKm('v.lat', 'v.lng')} <= c.radius_km
         AND v.owner_id <> $1
         AND NOT EXISTS (SELECT 1 FROM content.venue_managers vm WHERE vm.venue_id = v.id AND vm.user_id = $1)
         AND NOT ${blockedBetween('v.owner_id', '$1')}
         AND NOT EXISTS (SELECT 1 FROM content.boost_hidden h WHERE h.user_id = $1 AND h.venue_id = v.id)
         AND (c.target_kind <> 'event' OR EXISTS (SELECT 1 FROM content.venue_events e WHERE e.id = c.event_id AND e.cancelled_at IS NULL AND ${eventEnd('e')} > now()))
         AND (c.target_kind <> 'post' OR EXISTS (SELECT 1 FROM content.posts p WHERE p.id = c.post_id AND p.removed_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM content.feed_impressions fh WHERE fh.user_id = $1 AND fh.post_id = p.id AND fh.hidden)))
         ${extra}`;
  }

  /**
   * Os destaques de uma página do feed. `start` = quantas publicações a sessão já mostrou antes desta página; `items` = as
   * publicações da página; `last` = não há mais páginas. Um destaque nas posições 3, 14, 25… da sessão (ver boost-config),
   * ou, se a sessão acaba antes da primeira posição, um no fim. Regista as impressões (servidor, nunca a app).
   * `hydrate` traz a publicação ou o evento como o feed os mostra (null se quem vê já não os pode ver).
   */
  async feedSlots<P, E>(
    viewerId: string,
    center: BoostCenter,
    page: { start: number; items: { id: string }[]; last: boolean },
    hydrate: { post: (id: string) => Promise<P | null>; event: (id: string) => Promise<E | null> },
  ): Promise<SponsoredSlot<P, E>[]> {
    let positions = feedSlotPositions(page.start, page.items.length);
    if (!positions.length && page.last && page.start <= FEED_FIRST_SLOT) positions = [page.start + page.items.length - 1];
    if (!positions.length) return [];
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT x.*, (SELECT count(*) FROM content.boost_impressions i
                       WHERE i.campaign_id = x.id AND i.user_id = $1 AND i.kind = 'view' AND i.surface = 'feed' AND i.created_at > now() - interval '24 hours')::int AS seen
           FROM (${this.eligible(`AND (c.post_id IS NULL OR NOT (c.post_id = ANY($4::uuid[])))`)}) x
       ) y WHERE y.seen < ${FEED_CAP_PER_DAY} ORDER BY y.seen, random() LIMIT $5`,
      [viewerId, center.lat, center.lng, page.items.map((i) => i.id), positions.length + 3],
    );
    const out: SponsoredSlot<P, E>[] = [];
    for (const r of rows) {
      if (out.length >= positions.length) break;
      const post = r.target_kind === 'post' ? await hydrate.post(r.post_id as string).catch(() => null) : null;
      const event = r.target_kind === 'event' ? await hydrate.event(r.event_id as string).catch(() => null) : null;
      if (!post && !event) continue;
      const at = positions[out.length] - page.start;
      out.push({
        campaignId: r.id as string,
        afterId: at >= 0 ? page.items[at]?.id ?? null : null,
        label: SPONSORED_LABEL,
        kind: r.target_kind as 'post' | 'event',
        venue: { slug: r.venue_slug as string, name: r.venue_name as string, avatarUrl: media(r.avatar_media_id), verified: !!r.verified },
        post,
        event,
      });
    }
    if (out.length) {
      await this.pool.query(
        `INSERT INTO content.boost_impressions (id, campaign_id, user_id, kind, surface)
         SELECT x.id, x.campaign_id, $1, 'view', 'feed' FROM unnest($2::uuid[], $3::uuid[]) AS x(id, campaign_id)`,
        [viewerId, out.map(() => uuidv7()), out.map((s) => s.campaignId)],
      );
    }
    return out;
  }

  /** Os destaques do mapa do "À tua volta" para esta pessoa neste sítio (sem limite por dia; a impressão conta 1 vez por hora). */
  async forMap(viewerId: string, center: BoostCenter): Promise<MapBoost[]> {
    const { rows } = await this.pool.query(this.eligible(), [viewerId, center.lat, center.lng]);
    return rows.map((r) => ({ campaignId: r.id as string, venueId: r.venue_id as string, venueSlug: r.venue_slug as string, eventId: (r.event_id as string | null) ?? null, kind: r.target_kind as 'post' | 'event' }));
  }

  /** Regista as impressões no mapa das campanhas que ficaram realçadas (no máximo uma por pessoa e campanha a cada hora). */
  async recordMapViews(viewerId: string, campaignIds: string[]) {
    if (!campaignIds.length) return;
    await this.pool.query(
      `INSERT INTO content.boost_impressions (id, campaign_id, user_id, kind, surface)
       SELECT x.id, x.campaign_id, $1, 'view', 'map' FROM unnest($2::uuid[], $3::uuid[]) AS x(id, campaign_id)
        WHERE NOT EXISTS (SELECT 1 FROM content.boost_impressions i WHERE i.campaign_id = x.campaign_id AND i.user_id = $1 AND i.kind = 'view'
                            AND i.surface = 'map' AND i.created_at > now() - interval '${MAP_VIEW_GAP_MINUTES} minutes')`,
      [viewerId, campaignIds.map(() => uuidv7()), campaignIds],
    );
  }

  /* ───────────── campanhas e relatório ───────────── */

  /**
   * Uma campanha com o relatório. Só totais: impressões (vezes mostrado), pessoas distintas, toques, "Tenho interesse" no
   * evento e check-ins no local durante a campanha (e quantos desses foram de quem viu o destaque antes). Nunca quem.
   */
  private readonly CAMPAIGN_SELECT = `
    SELECT c.*, v.slug AS venue_slug, v.name AS venue_name,
           e.title AS event_title, p.short_code AS post_code, left(p.body, 140) AS post_body,
           s.views, s.feed_views, s.map_views, s.people, s.taps,
           (SELECT count(*) FROM content.venue_event_interest vi
             WHERE c.event_id IS NOT NULL AND vi.event_id = c.event_id AND vi.created_at >= c.starts_at AND vi.created_at < ${EFFECTIVE_END})::int AS interested,
           (SELECT count(*) FROM content.cheers ch
             WHERE c.post_id IS NOT NULL AND ch.post_id = c.post_id AND ch.created_at >= c.starts_at AND ch.created_at < ${EFFECTIVE_END})::int AS cheers,
           (SELECT count(*) FROM content.checkins ck
             WHERE ck.venue_id = c.venue_id AND ck.created_at >= c.starts_at AND ck.created_at < ${EFFECTIVE_END})::int AS checkins,
           (SELECT count(*) FROM content.checkins ck
             WHERE ck.venue_id = c.venue_id AND ck.created_at >= c.starts_at AND ck.created_at < ${EFFECTIVE_END}
               AND EXISTS (SELECT 1 FROM content.boost_impressions bi WHERE bi.campaign_id = c.id AND bi.user_id = ck.user_id AND bi.kind = 'view' AND bi.created_at <= ck.created_at))::int AS checkins_seen
      FROM content.boost_campaigns c
      JOIN content.venues v ON v.id = c.venue_id
      LEFT JOIN content.venue_events e ON e.id = c.event_id
      LEFT JOIN content.posts p ON p.id = c.post_id
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE i.kind = 'view')::int AS views,
               count(*) FILTER (WHERE i.kind = 'view' AND i.surface = 'feed')::int AS feed_views,
               count(*) FILTER (WHERE i.kind = 'view' AND i.surface = 'map')::int AS map_views,
               count(DISTINCT i.user_id) FILTER (WHERE i.kind = 'view')::int AS people,
               count(*) FILTER (WHERE i.kind = 'tap')::int AS taps
          FROM content.boost_impressions i WHERE i.campaign_id = c.id
      ) s ON true`;

  private async campaign(id: string) {
    const r = (await this.pool.query(`${this.CAMPAIGN_SELECT} WHERE c.id = $1`, [id])).rows[0];
    if (!r) throw new NotFoundException('Campanha não encontrada');
    return this.dto(r);
  }

  private dto(r: Row) {
    const now = Date.now();
    const starts = new Date(r.starts_at as string);
    const ends = new Date(r.ends_at as string);
    const state =
      r.status === 'stopped' ? 'stopped'
        : r.status === 'suspended' ? 'suspended'
          : r.status === 'pending' ? 'pending'
            : r.status === 'draft' ? 'draft'
            : now < starts.getTime() ? 'scheduled'
              : now >= ends.getTime() ? 'ended' : 'active';
    return {
      id: r.id as string,
      /** 'scheduled' (ainda não começou), 'active', 'ended', 'stopped' (parada pelo local), 'suspended' (pela equipa), 'pending', 'draft' (à espera da compra na loja). */
      state: state as 'scheduled' | 'active' | 'ended' | 'stopped' | 'suspended' | 'pending' | 'draft',
      target: r.target_kind === 'event'
        ? { kind: 'event' as const, id: r.event_id as string, title: (r.event_title as string | null) ?? 'Evento' }
        : { kind: 'post' as const, id: r.post_id as string, code: (r.post_code as string | null) ?? null, title: ((r.post_body as string | null) || 'Publicação do local') },
      package: r.package as string,
      days: Number(r.days),
      radiusKm: Number(r.radius_km),
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      stoppedAt: r.stopped_at ? new Date(r.stopped_at as string).toISOString() : null,
      payment: r.payment as BoostPayment | 'iap',
      price: Number(r.price),
      refunded: Number(r.refunded),
      review: r.review as 'auto' | 'staff',
      note: (r.status_note as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
      label: SPONSORED_LABEL,
      report: {
        impressions: Number(r.views ?? 0),
        feedImpressions: Number(r.feed_views ?? 0),
        mapImpressions: Number(r.map_views ?? 0),
        people: Number(r.people ?? 0),
        taps: Number(r.taps ?? 0),
        /** "Tenho interesse" no evento durante a campanha (só nas campanhas de evento). */
        interested: r.target_kind === 'event' ? Number(r.interested ?? 0) : null,
        /** Brindes à publicação durante a campanha (só nas campanhas de publicação). */
        cheers: r.target_kind === 'post' ? Number(r.cheers ?? 0) : null,
        checkins: Number(r.checkins ?? 0),
        /** Check-ins de quem viu o destaque antes de fazer o check-in. */
        checkinsAfterSeeing: Number(r.checkins_seen ?? 0),
      },
    };
  }
}
