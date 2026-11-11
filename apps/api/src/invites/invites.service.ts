import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { ageOf } from '@txillapp/shared';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import { WalletService } from '../wallet/wallet.service';
import { ogCardPng, phraseIndexOf, PHRASES } from './card';
import { INVITE, isDisposable, newCode } from './rules';

/** Idade a partir da qual há bebidas alcoólicas (a mesma da geleira). */
const ADULT = 18;

/** Um item da geleira no cartão: só o nome e o tipo (nada de notas, nem de quem mais o tem). */
export interface CardItem { name: string; kind: string; category: string; alcoholic: boolean; favorite: boolean }

/**
 * Os itens da geleira que podem ir no cartão: só aprovados, e só se a geleira está à vista de todos e a conta não é privada
 * (o cartão vai para quem não tem conta). `$2` = false tira as bebidas alcoólicas (quem convida é menor, ou quem vê é desconhecido).
 */
const CARD_ITEMS_SQL = `SELECT i.name, i.kind, i.category, i.alcoholic, ui.favorite
   FROM identity.users u JOIN taste.user_items ui ON ui.user_id = u.id JOIN taste.items i ON i.id = ui.item_id
  WHERE u.id = $1 AND u.status = 'active' AND u.is_private = false AND u.geleira_visibility = 'everyone'
    AND i.status = 'curated' AND ($2 OR NOT i.alcoholic)
  ORDER BY ui.favorite DESC, ui.rating DESC NULLS LAST, ui.updated_at DESC LIMIT 30`;

/** Até `max` itens, de tipos diferentes primeiro (uma bebida, uma comida, uma vibe…), pela ordem de preferência da pessoa. */
export function pickItems<T extends { kind: string }>(rows: T[], max = 4): T[] {
  const out: T[] = [];
  const kinds = new Set<string>();
  for (const r of rows) if (out.length < max && !kinds.has(r.kind)) { out.push(r); kinds.add(r.kind); }
  for (const r of rows) if (out.length < max && !out.includes(r)) out.push(r);
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Um código com o feitio certo (as ligações antigas e as novas). */
export const cleanCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

/**
 * Convites. O código é da pessoa; quem entra com ele fica «registada». Quando fica ativa (email confirmado e publicou algo ou segue 3 pessoas),
 * ganha Txills na hora e o prémio de quem convidou fica em espera uns dias. Tudo passa pelo livro de movimentos, de forma idempotente.
 */
@Injectable()
export class InvitesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Convites');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly wallet: WalletService,
    private readonly push: PushService,
    private readonly notifications: NotificationsService,
    private readonly media: MediaService,
  ) {}

  /** Cartões já desenhados para a pré-visualização (pouco tempo, para uma foto ou uma geleira nova aparecerem depressa). */
  private readonly ogCache = new Map<string, { at: number; png: Buffer }>();

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn(`falha: ${(e as Error).message}`)), 5 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private origin() {
    return (this.config.WEB_ORIGIN.split(',')[0] ?? '').trim().replace(/\/$/, '');
  }

  /** O código desta pessoa (cria-o na primeira vez). */
  async code(userId: string): Promise<string> {
    const got = (await this.pool.query('SELECT code FROM social.invite_codes WHERE user_id = $1', [userId])).rows[0];
    if (got) return got.code as string;
    for (let i = 0; i < 6; i++) {
      try {
        const c = newCode();
        await this.pool.query('INSERT INTO social.invite_codes (user_id, code) VALUES ($1, $2)', [userId, c]);
        return c;
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e;
        const again = (await this.pool.query('SELECT code FROM social.invite_codes WHERE user_id = $1', [userId])).rows[0];
        if (again) return again.code as string;
      }
    }
    throw new Error('não consegui criar o código');
  }

  /** Quem pode convidar com prémio: email confirmado e conta com mais de 3 dias. */
  private async eligible(userId: string): Promise<{ ok: boolean; reason?: string }> {
    const u = (
      await this.pool.query(
        `SELECT status, email_verified_at IS NOT NULL AS verified, created_at < now() - ($2 || ' days')::interval AS old FROM identity.users WHERE id = $1`,
        [userId, String(INVITE.MIN_AGE_DAYS)],
      )
    ).rows[0];
    if (!u || u.status !== 'active') return { ok: false, reason: 'conta inativa' };
    if (!u.verified) return { ok: false, reason: 'Confirma o teu email para os convites darem Txills.' };
    if (!u.old) return { ok: false, reason: `Os convites dão Txills a partir de ${INVITE.MIN_AGE_DAYS} dias de conta.` };
    return { ok: true };
  }

  /** O ecrã «Convida a tua malta»: código, ligação, números e regras. */
  async me(userId: string) {
    const code = await this.code(userId);
    const s = (
      await this.pool.query(
        `SELECT count(*)::int AS invited,
                count(*) FILTER (WHERE status IN ('qualified', 'paid'))::int AS active,
                count(*) FILTER (WHERE status = 'qualified')::int AS pending,
                count(*) FILTER (WHERE status = 'paid')::int AS paid,
                coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0)::int AS earned,
                count(*) FILTER (WHERE qualified_at >= date_trunc('day', now()))::int AS today
           FROM social.referrals WHERE inviter_id = $1`,
        [userId],
      )
    ).rows[0];
    const el = await this.eligible(userId);
    return {
      code,
      // A ligação nova (/c/CÓDIGO) mostra o cartão na pré-visualização do WhatsApp; /register?convite= continua a funcionar.
      link: `${this.origin()}/c/${code}`,
      stats: s as { invited: number; active: number; pending: number; paid: number; earned: number; today: number },
      rules: { reward: INVITE.REWARD, perDay: INVITE.PER_DAY, maxPaid: INVITE.MAX_PAID, holdDays: INVITE.HOLD_DAYS },
      eligible: el.ok,
      note: el.ok ? null : (el.reason ?? null),
      card: await this.cardOf(userId),
    };
  }

  /**
   * O que a app precisa para desenhar o cartão no aparelho: nome, @, se há foto, se é maior de idade (para o álcool) e os
   * itens da geleira que a pessoa mostra a todos (nenhum se a geleira ou a conta não são públicas). Nunca a data de nascimento.
   */
  private async cardOf(userId: string) {
    const u = (
      await this.pool.query(
        `SELECT display_name, username, avatar_media_id IS NOT NULL AS has_avatar, birth_date::text AS b, is_private, geleira_visibility FROM identity.users WHERE id = $1`,
        [userId],
      )
    ).rows[0];
    const adult = !!u?.b && ageOf(u.b as string) >= ADULT;
    const items = (await this.pool.query(CARD_ITEMS_SQL, [userId, adult])).rows as CardItem[];
    return {
      displayName: (u?.display_name as string) ?? '',
      username: (u?.username as string) ?? '',
      hasAvatar: !!u?.has_avatar,
      adult,
      geleiraPublic: !!u && !u.is_private && u.geleira_visibility === 'everyone',
      items: items.map((i) => ({ name: i.name, kind: i.kind, category: i.category, alcoholic: i.alcoholic, favorite: i.favorite })),
    };
  }

  /** Quem é dono de um código ativo (conta ativa), ou nada. */
  private async ownerOf(raw: string) {
    const code = cleanCode(raw);
    if (code.length < 4) return null;
    const r = (
      await this.pool.query(
        `SELECT u.id, u.username, u.display_name, u.avatar_media_id IS NOT NULL AS has_avatar FROM social.invite_codes c JOIN identity.users u ON u.id = c.user_id AND u.status = 'active' WHERE c.code = $1 AND c.active`,
        [code],
      )
    ).rows[0];
    return r ? { code, id: r.id as string, username: r.username as string, displayName: r.display_name as string, hasAvatar: !!r.has_avatar } : null;
  }

  /** Itens públicos da geleira para quem não tem conta: nunca álcool (não se sabe a idade de quem abre). */
  private async publicItems(userId: string, max: number) {
    return pickItems((await this.pool.query(CARD_ITEMS_SQL, [userId, false])).rows as CardItem[], max).map((i) => i.name);
  }

  /**
   * Para a página de entrada («{Nome} convidou-te para o Txillapp») e o «Convite de …» no registo. Público: só o nome, o @,
   * se há foto (a foto já é pública em /avatars) e os itens da geleira que a pessoa mostra a todos.
   */
  async preview(raw: string) {
    const o = await this.ownerOf(raw);
    if (!o) throw new NotFoundException('Convite não encontrado');
    return { username: o.username, displayName: o.displayName, hasAvatar: o.hasAvatar, items: await this.publicItems(o.id, 4), reward: INVITE.REWARD, phrase: PHRASES[phraseIndexOf(o.code)] };
  }

  /**
   * A página que os robôs das redes (WhatsApp, Facebook, Telegram…) leem quando alguém partilha /c/CÓDIGO: o título
   * «{Nome} convidou-te para o Txillapp» e o cartão como imagem. Código desconhecido: o cartão genérico (sem dizer que não existe).
   */
  async sharePage(raw: string, host: string | undefined) {
    const origin = `https://${host ?? 'txillapp.com'}`;
    const o = await this.ownerOf(raw);
    const code = o?.code ?? cleanCode(raw);
    const url = `${origin}/c/${code}`;
    const title = o ? `${o.displayName} convidou-te para o Txillapp` : 'Txillapp, a rede da malta';
    const description = o
      ? `${PHRASES[phraseIndexOf(o.code)]} Entra com o código ${o.code} e ganha ${INVITE.REWARD} Txills.`
      : 'Fotos, vídeos, mimos, tchekas e chat em tempo real com a malta.';
    const image = o ? `${origin}/api/v1/invites/card/${o.code}.png` : `${origin}/icon-512.png`;
    const size = o ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:type" content="image/png">' : '';
    return (
      `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}">` +
      `<meta property="og:site_name" content="Txillapp"><meta property="og:type" content="website">` +
      `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">` +
      `<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">${size}` +
      `<meta property="og:image:alt" content="${esc(o ? `Cartão de convite de ${o.displayName}` : 'Txillapp')}">` +
      `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">` +
      `<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">` +
      `</head><body><p><a href="${esc(url)}">Abrir o convite no Txillapp</a></p></body></html>`
    );
  }

  /** A foto de perfil em bytes (disco ou S3), para o cartão do servidor. */
  private async avatarBytes(username: string): Promise<Buffer | null> {
    try {
      const found = await this.media.avatarOf(username);
      if (!found) return null;
      if ('url' in found) {
        const r = await fetch(found.url, { signal: AbortSignal.timeout(4000) });
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      }
      return await readFile(found.path);
    } catch {
      return null;
    }
  }

  /** O cartão do convite em PNG (1200×630) para a pré-visualização; null se o código não existe. Guardado 10 minutos. */
  async ogImage(raw: string): Promise<Buffer | null> {
    const o = await this.ownerOf(raw);
    if (!o) return null;
    const hit = this.ogCache.get(o.code);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.png;
    const png = await ogCardPng({
      code: o.code,
      displayName: o.displayName,
      items: await this.publicItems(o.id, 3),
      reward: INVITE.REWARD,
      avatar: o.hasAvatar ? await this.avatarBytes(o.username) : null,
    });
    if (this.ogCache.size > 300) this.ogCache.delete(this.ogCache.keys().next().value!);
    this.ogCache.set(o.code, { at: Date.now(), png });
    return png;
  }

  /**
   * Regista que esta pessoa entrou com o convite de alguém (chamado a seguir ao registo; nunca falha o registo).
   * `net`: a impressão da rede (nunca o IP). Se o convite conta, quem convidou é avisado logo («{nome} entrou com o teu
   * convite») e quem entrou recebe já os Txills de boas-vindas do convite; o prémio de quem convidou continua à espera
   * de a pessoa ficar ativa e dos dias de espera.
   */
  async attach(inviteeId: string, rawCode: string | undefined, email: string, net: string | null) {
    if (!rawCode) return;
    try {
      const inviter = (await this.pool.query('SELECT user_id FROM social.invite_codes WHERE code = $1 AND active', [cleanCode(rawCode)])).rows[0];
      if (!inviter || inviter.user_id === inviteeId) return;
      const inviterId = inviter.user_id as string;
      let status = 'registered';
      let reason: string | null = null;
      if (isDisposable(email)) {
        status = 'blocked';
        reason = 'email temporário';
      } else if (net) {
        const n = (await this.pool.query("SELECT count(*)::int AS n FROM social.referrals WHERE inviter_id = $1 AND ip_hash = $2 AND created_at > now() - interval '24 hours'", [inviterId, net])).rows[0].n as number;
        if (n >= INVITE.SAME_NET_MAX) {
          status = 'blocked';
          reason = 'mesma rede';
        }
      }
      const ins = await this.pool.query(
        'INSERT INTO social.referrals (invitee_id, inviter_id, status, reason, ip_hash) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [inviteeId, inviterId, status, reason, net],
      );
      if (!ins.rowCount || status !== 'registered') return;
      await this.notifications.notify({ userId: inviterId, actorId: inviteeId, kind: 'invite_joined' });
      await this.welcome(inviteeId, inviterId);
    } catch (e) {
      this.log.warn(`convite no registo: ${(e as Error).message}`);
    }
  }

  /**
   * Os Txills de boas-vindas do convite, logo no registo. As mesmas condições do prémio (quem convida pode convidar com prémio,
   * não passou do teto total, e há orçamento no mês). A chave é a mesma da altura em que a pessoa fica ativa: nunca paga duas vezes.
   */
  private async welcome(inviteeId: string, inviterId: string): Promise<boolean> {
    if (!(await this.eligible(inviterId)).ok) return false; // fica para quando ficar ativa (como antes)
    const c = (
      await this.pool.query(
        `SELECT count(*) FILTER (WHERE r.status IN ('qualified', 'paid'))::int AS total, max(u.username) AS username
           FROM identity.users u LEFT JOIN social.referrals r ON r.inviter_id = u.id WHERE u.id = $1`,
        [inviterId],
      )
    ).rows[0];
    if (c.total >= INVITE.MAX_PAID) return false;
    if (INVITE.MONTHLY_BUDGET - (await this.issuedThisMonth()) < INVITE.REWARD * 2) return false;
    await this.wallet.credit(inviteeId, INVITE.REWARD, `invite:in:${inviteeId}`, { invite: 'in', from: c.username, at: 'signup' }, undefined, 'invite');
    return true;
  }

  /** Txills emitidos este mês em convites (para o teto mensal). */
  private async issuedThisMonth(): Promise<number> {
    const r = await this.pool.query(
      `SELECT coalesce(sum(e.amount), 0)::bigint AS n FROM ledger.transactions t JOIN ledger.entries e ON e.transaction_id = t.id
        WHERE t.type = 'invite' AND e.amount > 0 AND t.created_at >= date_trunc('month', now())`,
    );
    return Number(r.rows[0].n);
  }

  /** Passa as pessoas convidadas ao estado seguinte. Corre de 5 em 5 minutos (e nos testes, à mão). */
  async sweep(): Promise<{ qualified: number; paid: number }> {
    let qualified = 0;
    let paid = 0;
    let budget = INVITE.MONTHLY_BUDGET - (await this.issuedThisMonth());

    // A) quem ficou ativa
    const cands = (
      await this.pool.query(
        `SELECT r.invitee_id, r.inviter_id, ui.username AS inviter_username
           FROM social.referrals r
           JOIN identity.users u ON u.id = r.invitee_id AND u.status = 'active' AND u.email_verified_at IS NOT NULL
           JOIN identity.users ui ON ui.id = r.inviter_id AND ui.status = 'active'
          WHERE r.status = 'registered'
            AND (EXISTS (SELECT 1 FROM content.posts p WHERE p.author_id = u.id AND p.removed_at IS NULL)
                 OR (SELECT count(*) FROM social.follows f WHERE f.follower_id = u.id) >= $1)
          ORDER BY r.created_at LIMIT 200`,
        [INVITE.ACTIVE_FOLLOWS],
      )
    ).rows;
    for (const c of cands) {
      const inviter = c.inviter_id as string;
      const invitee = c.invitee_id as string;
      const el = await this.eligible(inviter);
      if (!el.ok) continue; // espera que a pessoa que convidou cumpra as condições
      const counts = (
        await this.pool.query(
          `SELECT count(*) FILTER (WHERE status IN ('qualified', 'paid'))::int AS total,
                  count(*) FILTER (WHERE qualified_at >= date_trunc('day', now()))::int AS today
             FROM social.referrals WHERE inviter_id = $1`,
          [inviter],
        )
      ).rows[0];
      if (counts.total >= INVITE.MAX_PAID) {
        await this.pool.query(`UPDATE social.referrals SET status = 'blocked', reason = 'limite total' WHERE invitee_id = $1 AND status = 'registered'`, [invitee]);
        continue;
      }
      if (counts.today >= INVITE.PER_DAY) continue; // fica para amanhã
      if (budget < INVITE.REWARD * 2) continue; // teto mensal: fica para o mês seguinte
      const up = await this.pool.query(
        `UPDATE social.referrals SET status = 'qualified', qualified_at = now(), release_at = now() + ($2 || ' days')::interval WHERE invitee_id = $1 AND status = 'registered'`,
        [invitee, String(INVITE.HOLD_DAYS)],
      );
      if (!up.rowCount) continue;
      await this.wallet.credit(invitee, INVITE.REWARD, `invite:in:${invitee}`, { invite: 'in', from: c.inviter_username }, undefined, 'invite');
      budget -= INVITE.REWARD * 2;
      qualified++;
    }

    // B) libertar o prémio de quem convidou
    const due = (
      await this.pool.query(
        `SELECT r.invitee_id, r.inviter_id, u.display_name AS invitee_name
           FROM social.referrals r
           JOIN identity.users u ON u.id = r.invitee_id AND u.status = 'active'
           JOIN identity.users ui ON ui.id = r.inviter_id AND ui.status = 'active'
          WHERE r.status = 'qualified' AND r.release_at <= now() LIMIT 200`,
      )
    ).rows;
    for (const d of due) {
      await this.wallet.credit(d.inviter_id as string, INVITE.REWARD, `invite:out:${d.invitee_id}`, { invite: 'out' }, undefined, 'invite');
      await this.pool.query(`UPDATE social.referrals SET status = 'paid', paid_at = now(), amount = $2 WHERE invitee_id = $1`, [d.invitee_id, INVITE.REWARD]);
      // A entrada já foi avisada no registo (invite_joined); este é o aviso do prémio.
      void this.push.send(d.inviter_id as string, { title: 'Convite', body: `${d.invitee_name as string} já te deu Txills: +${INVITE.REWARD} pelo convite`, url: '/invites', tag: `invite:${d.invitee_id as string}`, category: 'invites' });
      paid++;
    }
    return { qualified, paid };
  }
}
