import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { ChatEvents } from '../chat/chat.events';
import { ChatService } from '../chat/chat.service';
import { badge } from '../common/badge';
import { extractHashtags } from '../common/hashtags';
import { classify } from '../common/topics';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { GroupAccess } from '../groups/group-access';
import { mentionableBy, NotificationsService } from '../notifications/notifications.service';
import { PostsService } from '../posts/posts.service';
import { TextFilter } from '../safety/text-filter.service';
import { SearchIndexer } from '../search/search-index';
import { blockedBetween, canView } from '../social/visibility';
import { adultSql, maskFor, requestCards, requestText, roundCards, type Drink, type Person, type RequestDto } from './gelada-cards';

/**
 * «Paga-me uma» (0145), fase 1: sem dinheiro. Nada aqui mexe em Txills nem em pagamentos.
 *
 * Pedidos: quem pede escolhe uma bebida e um ou mais amigos e manda no CHAT (um cartão kind 'gelada' em cada conversa, com as
 * regras de mensagens: bloqueios, `dms_allowed`, limite a quem não me segue) ou PUBLICA (uma publicação com o cartão; cada
 * pessoa fica identificada; só a seguidores mútuos, que aceitam menções e me podem ver). Quem recebe responde «Bora!»,
 * «Hoje não» ou «Fica a dever» (cria uma dívida no livro). Limites: 10 pedidos por dia por pessoa e 3 por dia ao mesmo amigo
 * (dias de Maputo; chat e publicação contam juntos). Nunca há desafios de quantidade: um pedido é sempre uma bebida.
 *
 * Idade: menores de 18 anos (ou sem data de nascimento) não têm álcool. Um menor só escolhe bebidas sem álcool; um pedido com
 * álcool a um menor passa logo a refresco (a minha bebida sem álcool favorita, senão uma Coca-Cola).
 *
 * O livro: dívidas entre duas pessoas. «Já paguei» (o devedor) só fica pago quando a outra pessoa confirma; «Perdoar» (quem
 * recebia) fecha. Por omissão só as duas pessoas veem as dívidas entre elas; o dono pode mostrar o seu livro a quem vê a
 * geleira (identity.users.gelada_book_public).
 *
 * Rodadas: no TxillGroup, um cartão kind 'rodada'. Cada membro entra (com a bebida) ou diz «Esta pago eu». Fechar fica no
 * histórico de quem pagou e, se quem pagou pedir, cria as dívidas de quem bebeu.
 */

/** Quantos pedidos por dia (dias de Maputo), no total e ao mesmo amigo. Chat e publicação contam juntos. */
export const DAY_MAX = 10;
export const FRIEND_DAY_MAX = 3;
/** Quantas dívidas à mão («Fico a dever-te uma») por dia. */
const MANUAL_DAY_MAX = 10;
/** O refresco de recurso quando um pedido passa a sem álcool e não tenho nenhum na geleira. */
const FALLBACK_SOFT = 'beb-coca-cola';

type Db = Pool | PoolClient;
type Answer = 'accept' | 'decline' | 'owe';

/** O início do dia de hoje em Maputo (para os limites diários). */
const TODAY = `((date_trunc('day', now() AT TIME ZONE 'Africa/Maputo')) AT TIME ZONE 'Africa/Maputo')`;

/** SQL: `viewer` pode ver a geleira do dono `u` (a mesma regra de GeleiraService.owner: conta visível e a visibilidade da geleira). */
const geleiraShown = (u: string, viewer: string) =>
  `(${canView(u, viewer)} AND (${u}.id = ${viewer} OR ${u}.geleira_visibility = 'everyone'
     OR (${u}.geleira_visibility = 'followers' AND EXISTS (SELECT 1 FROM social.follows gf WHERE gf.follower_id = ${viewer} AND gf.followee_id = ${u}.id))
     OR (${u}.geleira_visibility = 'close_friends' AND EXISTS (SELECT 1 FROM social.close_friends gcf WHERE gcf.owner_id = ${u}.id AND gcf.friend_id = ${viewer}))))`;

interface DrinkRow extends Drink { id: string }

export interface DebtDto {
  id: string;
  debtor: Person;
  creditor: Person;
  drink: Drink;
  source: 'request' | 'round' | 'manual';
  status: 'open' | 'paid' | 'forgiven';
  /** O devedor disse «Já paguei» e falta a confirmação de quem recebe. */
  claimed: boolean;
  claimedAt: string | null;
  /** A prova, se a deixou: a foto e/ou o local. */
  photoUrl: string | null;
  venue: { slug: string; name: string } | null;
  /** Eu devo / devem-me. */
  iOwe: boolean;
  owedToMe: boolean;
  canClaim: boolean;
  canConfirm: boolean;
  canForgive: boolean;
  at: string;
  closedAt: string | null;
}

const personOf = (r: Record<string, any>, p: string): Person =>
  r[`${p}_status`] !== 'active'
    ? { username: '', displayName: 'Conta eliminada', hasAvatar: false, ...badge(false, null) }
    : { username: r[`${p}_username`] as string, displayName: r[`${p}_name`] as string, hasAvatar: !!r[`${p}_avatar`], ...badge(r[`${p}_verified`], r[`${p}_tier`]) };
const personCols = (a: string, p: string) =>
  `${a}.username AS ${p}_username, ${a}.display_name AS ${p}_name, (${a}.avatar_media_id IS NOT NULL) AS ${p}_avatar, ${a}.verified AS ${p}_verified, ${a}.verified_tier AS ${p}_tier, ${a}.status AS ${p}_status`;

@Injectable()
export class GeladaService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly chat: ChatService,
    private readonly events: ChatEvents,
    private readonly access: GroupAccess,
    private readonly notifications: NotificationsService,
    private readonly posts: PostsService,
    private readonly indexer: SearchIndexer,
    private readonly filter: TextFilter,
  ) {}

  /* ───────────── peças ───────────── */

  private async adult(userId: string, db: Db = this.pool) {
    return (await db.query(`SELECT ${adultSql('u')} AS a FROM identity.users u WHERE u.id = $1`, [userId])).rows[0]?.a === true;
  }

  private async userByName(username: string) {
    const name = username.trim().replace(/^@/, '');
    const { rows } = await this.pool.query(`SELECT u.id, u.username, u.status, ${adultSql('u')} AS adult FROM identity.users u WHERE lower(u.username) = lower($1)`, [name]);
    if (!rows[0] || rows[0].status !== 'active') throw new NotFoundException(`@${name} não existe`);
    return rows[0] as { id: string; username: string; adult: boolean };
  }

  /** Uma bebida do catálogo que posso escolher: aprovada (ou sugerida por mim); com álcool só para quem tem 18 anos. */
  private async drinkOf(userId: string, itemId: string, adult: boolean): Promise<DrinkRow> {
    const { rows } = await this.pool.query(
      `SELECT id, slug, name, category, alcoholic FROM taste.items
        WHERE id = $1 AND kind = 'bebida' AND (status = 'curated' OR (status = 'pending' AND created_by = $2))`,
      [itemId, userId],
    );
    const d = rows[0] as DrinkRow | undefined;
    if (!d || (d.alcoholic && !adult)) throw new NotFoundException('Essa bebida não existe');
    return { id: d.id, slug: d.slug, name: d.name, category: d.category, alcoholic: !!d.alcoholic };
  }

  /** O refresco que entra no lugar de uma bebida com álcool: a minha bebida sem álcool preferida da geleira, senão uma Coca-Cola. */
  private async softFor(userId: string): Promise<DrinkRow> {
    const { rows } = await this.pool.query(
      `SELECT i.id, i.slug, i.name, i.category, i.alcoholic FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
        WHERE ui.user_id = $1 AND i.kind = 'bebida' AND NOT i.alcoholic AND i.status = 'curated'
        ORDER BY ui.favorite DESC, ui.rating DESC NULLS LAST, ui.updated_at DESC LIMIT 1`,
      [userId],
    );
    const r = rows[0] ?? (await this.pool.query('SELECT id, slug, name, category, alcoholic FROM taste.items WHERE slug = $1', [FALLBACK_SOFT])).rows[0];
    if (!r) return { id: '', slug: FALLBACK_SOFT, name: 'Coca-Cola', category: 'refrigerante', alcoholic: false };
    return { id: r.id as string, slug: r.slug as string, name: r.name as string, category: r.category as string, alcoholic: false };
  }

  /**
   * As bebidas que posso pedir (a estas pessoas): as da minha geleira primeiro (favoritas, com nota), depois o catálogo.
   * `soft`: sem álcool (eu ou alguma delas tem menos de 18 anos). `suggested`: a minha favorita (a que vem escolhida).
   * `left`: quantos pedidos ainda posso fazer hoje.
   */
  async drinks(me: string, to: string[]) {
    const iAmAdult = await this.adult(me);
    let soft = !iAmAdult;
    for (const name of [...new Set(to.map((n) => n.trim()).filter(Boolean))].slice(0, 10)) {
      const r = await this.pool.query(`SELECT ${adultSql('u')} AS adult FROM identity.users u WHERE lower(u.username) = lower($1) AND u.status = 'active'`, [name.replace(/^@/, '')]);
      if (r.rows[0] && !r.rows[0].adult) soft = true;
    }
    const { rows } = await this.pool.query(
      `SELECT i.id, i.slug, i.name, i.category, i.alcoholic, (ui.user_id IS NOT NULL) AS mine, COALESCE(ui.favorite, false) AS favorite
         FROM taste.items i LEFT JOIN taste.user_items ui ON ui.item_id = i.id AND ui.user_id = $1
        WHERE i.kind = 'bebida' AND (i.status = 'curated' OR (i.status = 'pending' AND i.created_by = $1)) AND ($2::boolean = false OR NOT i.alcoholic)
        ORDER BY (ui.user_id IS NOT NULL) DESC, ui.favorite DESC NULLS LAST, ui.rating DESC NULLS LAST, (SELECT count(*) FROM taste.user_items f WHERE f.item_id = i.id) DESC, i.name
        LIMIT 300`,
      [me, soft],
    );
    const drinks = rows.map((r) => ({ id: r.id as string, slug: r.slug as string, name: r.name as string, category: r.category as string, alcoholic: !!r.alcoholic, mine: !!r.mine, favorite: !!r.favorite }));
    const used = (await this.pool.query(`SELECT count(*)::int AS n FROM taste.gelada_requests WHERE requester_id = $1 AND created_at >= ${TODAY}`, [me])).rows[0].n as number;
    return { soft, drinks, suggested: (drinks.find((d) => d.favorite) ?? drinks.find((d) => d.mine))?.id ?? null, left: Math.max(0, DAY_MAX - used), max: DAY_MAX };
  }

  /* ───────────── pedidos ───────────── */

  /**
   * «Paga-me uma»: um pedido a cada pessoa de `to`, no chat ou numa publicação. Valida tudo antes de criar o que quer que
   * seja (uma pessoa que não pode receber faz falhar o pedido todo, com o @ dela na mensagem). Devolve os pedidos (como eu os
   * vejo) e, na publicação, a publicação.
   */
  async ask(me: string, b: { to: string[]; itemId: string; channel: 'chat' | 'post'; caption?: string }) {
    const names = [...new Set(b.to.map((n) => n.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
    if (!names.length) throw new BadRequestException('Escolhe pelo menos um amigo');
    if (names.length > DAY_MAX) throw new BadRequestException(`No máximo ${DAY_MAX} amigos de cada vez`);
    const caption = (b.caption ?? '').trim().slice(0, 300);
    if (b.channel === 'post') this.filter.assertClean(caption);
    const iAmAdult = await this.adult(me);
    const picked = await this.drinkOf(me, b.itemId, iAmAdult);
    const people = [];
    for (const n of names) {
      const u = await this.userByName(n);
      if (u.id === me) throw new BadRequestException('Não podes pedir uma a ti próprio');
      people.push(u);
    }

    // Limites do dia: 10 no total e 3 ao mesmo amigo (chat e publicação juntos).
    const used = (await this.pool.query(`SELECT count(*)::int AS n FROM taste.gelada_requests WHERE requester_id = $1 AND created_at >= ${TODAY}`, [me])).rows[0].n as number;
    if (used + people.length > DAY_MAX) {
      throw new HttpException(used >= DAY_MAX ? `Já fizeste ${DAY_MAX} pedidos hoje. Amanhã há mais 🙌` : `Hoje só podes pedir a mais ${DAY_MAX - used}.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    for (const p of people) {
      const n = (await this.pool.query(`SELECT count(*)::int AS n FROM taste.gelada_requests WHERE requester_id = $1 AND recipient_id = $2 AND created_at >= ${TODAY}`, [me, p.id])).rows[0].n as number;
      if (n >= FRIEND_DAY_MAX) throw new HttpException(`Já pediste ${FRIEND_DAY_MAX} hoje a @${p.username}. Dá-lhe um descanso 😅`, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Quem pode receber.
    for (const p of people) {
      if (b.channel === 'chat') {
        const why = await this.chat.cannotMessage(me, p.id);
        if (why) throw new ForbiddenException(`@${p.username}: ${why}`);
      } else {
        const ok = (
          await this.pool.query(
            `SELECT ${blockedBetween('u.id', '$1')} AS blocked,
                    (EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
                     AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1)) AS mutual,
                    ${mentionableBy('u', '$1')} AS mentionable, ${canView('au', 'u.id')} AS sees_me
               FROM identity.users u, identity.users au WHERE u.id = $2 AND au.id = $1`,
            [me, p.id],
          )
        ).rows[0];
        if (ok.blocked) throw new ForbiddenException(`Não podes pedir a @${p.username}`);
        if (!ok.mutual) throw new ForbiddenException(`Em público só pedes a quem te segue e tu segues de volta. Manda no chat a @${p.username}.`);
        if (!ok.mentionable) throw new ForbiddenException(`@${p.username} não deixa ser mencionado. Manda-lhe no chat.`);
        if (!ok.sees_me) throw new ForbiddenException(`@${p.username} não consegue ver as tuas publicações. Manda-lhe no chat.`);
      }
    }

    // A bebida de cada um: com álcool só se os dois são adultos (senão passa a refresco).
    let soft: DrinkRow | null = null;
    const drinkFor = async (adult: boolean): Promise<DrinkRow> => {
      if (!picked.alcoholic || (iAmAdult && adult)) return picked;
      soft ??= await this.softFor(me);
      return soft;
    };

    if (b.channel === 'chat') {
      const ids: string[] = [];
      for (const p of people) {
        const d = await drinkFor(p.adult);
        const id = uuidv7();
        const msgId = uuidv7();
        await this.pool.query(
          `INSERT INTO taste.gelada_requests (id, requester_id, recipient_id, item_id, drink_slug, drink_name, drink_category, alcoholic, channel, message_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'chat', $9)`,
          [id, me, p.id, d.id || null, d.slug, d.name, d.category, d.alcoholic, msgId],
        );
        try {
          await this.chat.sendCard(me, p.id, 'gelada', requestText(d), d.alcoholic ? 'pede-te uma gelada 🍻' : 'pede-te um refresco 🥤', msgId);
        } catch (e) {
          await this.pool.query('DELETE FROM taste.gelada_requests WHERE id = $1', [id]);
          throw e;
        }
        ids.push(id);
      }
      return { requests: await requestCards(this.pool, me, { ids }), post: null };
    }

    // Publicar: uma publicação com o cartão; cada pessoa identificada tem o seu pedido.
    const drinks = await Promise.all(people.map((p) => drinkFor(p.adult)));
    const postDrink = drinks.find((d) => d.alcoholic) ?? drinks[0];
    const postId = uuidv7();
    const ids: string[] = [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const topics = [...new Set(['bebidas', ...classify(caption, extractHashtags(caption))])];
      await client.query('INSERT INTO content.posts (id, author_id, body, topics, gelada) VALUES ($1, $2, $3, $4, $5)', [
        postId, me, caption, topics, JSON.stringify({ v: 1, drink: { slug: postDrink.slug, name: postDrink.name, category: postDrink.category, alcoholic: postDrink.alcoholic }, count: people.length }),
      ]);
      for (const tag of extractHashtags(caption)) await client.query('INSERT INTO content.post_tags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, tag]);
      for (const [i, p] of people.entries()) {
        const d = drinks[i];
        const id = uuidv7();
        await client.query(
          `INSERT INTO taste.gelada_requests (id, requester_id, recipient_id, item_id, drink_slug, drink_name, drink_category, alcoholic, channel, post_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'post', $9)`,
          [id, me, p.id, d.id || null, d.slug, d.name, d.category, d.alcoholic, postId],
        );
        ids.push(id);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    this.indexer.postChanged(postId);
    for (const [i, p] of people.entries()) {
      await this.notifications.notify({ userId: p.id, actorId: me, kind: 'gelada_tag', data: { requestId: ids[i], postId, soft: !drinks[i].alcoholic } });
    }
    if (caption) void this.notifications.notifyMentions(me, caption, { postId, snippet: caption.slice(0, 80) });
    return { requests: await requestCards(this.pool, me, { ids }), post: await this.posts.getOne(me, postId) };
  }

  /** Um pedido, como eu o vejo (sou uma das partes, ou vejo a publicação). */
  async request(me: string, id: string): Promise<RequestDto> {
    const [r] = await requestCards(this.pool, me, { ids: [id] });
    if (!r) throw new NotFoundException('Pedido não encontrado');
    if (r.channel === 'post' && !r.mine && !r.forMe) await this.posts.getOne(me, r.postId!); // tem de ver a publicação
    return r;
  }

  /**
   * Responder a um pedido (só quem o recebeu, uma vez): «Bora!» (accept), «Hoje não» (decline) ou «Fica a dever» (owe: cria a
   * dívida no livro). O cartão põe-se em dia para os dois em tempo real (chat) e quem pediu é avisado (publicação).
   * Devolve { request, debt, chatWith } (`chatWith`: com quem combinar, depois do «Bora!»).
   */
  async answer(me: string, id: string, answer: Answer) {
    const client = await this.pool.connect();
    let row: Record<string, any>;
    let debtId: string | null = null;
    try {
      await client.query('BEGIN');
      row = (
        await client.query(
          `SELECT r.*, rq.username AS requester_username, rq.status AS requester_status, ${blockedBetween('r.requester_id', 'r.recipient_id')} AS blocked,
                  (SELECT p.removed_at IS NULL FROM content.posts p WHERE p.id = r.post_id) AS post_ok
             FROM taste.gelada_requests r JOIN identity.users rq ON rq.id = r.requester_id
            WHERE r.id = $1 AND r.recipient_id = $2 FOR UPDATE OF r`,
          [id, me],
        )
      ).rows[0];
      if (!row || row.requester_status !== 'active') throw new NotFoundException('Pedido não encontrado');
      if (row.blocked) throw new ForbiddenException('Não podes responder a este pedido');
      if (row.channel === 'post' && row.post_ok !== true) throw new NotFoundException('Esta publicação já não existe');
      if (row.status === 'untagged') throw new ConflictException('Saíste deste pedido');
      if (row.status !== 'pending') throw new ConflictException('Já respondeste a este pedido');
      const status = answer === 'accept' ? 'accepted' : answer === 'decline' ? 'declined' : 'owed';
      await client.query('UPDATE taste.gelada_requests SET status = $2, answered_at = now() WHERE id = $1', [id, status]);
      if (answer === 'owe') {
        debtId = uuidv7();
        await client.query(
          `INSERT INTO taste.gelada_debts (id, debtor_id, creditor_id, drink_slug, drink_name, drink_category, alcoholic, source, request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'request', $8)`,
          [debtId, me, row.requester_id, row.drink_slug, row.drink_name, row.drink_category, row.alcoholic, id],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    if (row.channel === 'chat') await this.chat.cardChanged(me, row.requester_id as string);
    else await this.notifications.notify({ userId: row.requester_id as string, actorId: me, kind: 'gelada_answer', data: { requestId: id, postId: row.post_id, answer, soft: !row.alcoholic } });
    return {
      request: await this.request(me, id),
      debt: debtId ? await this.debt(me, debtId) : null,
      chatWith: answer === 'accept' ? (row.requester_username as string) : null,
    };
  }

  /* ───────────── o livro ───────────── */

  private async debts(viewer: string, where: string, params: unknown[]): Promise<DebtDto[]> {
    const { rows } = await this.pool.query(
      `SELECT d.*, ${personCols('db', 'db')}, ${personCols('cr', 'cr')}, ${adultSql('vw')} AS viewer_adult,
              v.slug AS venue_slug, v.name AS venue_name
         FROM taste.gelada_debts d
         JOIN identity.users db ON db.id = d.debtor_id
         JOIN identity.users cr ON cr.id = d.creditor_id
         JOIN identity.users vw ON vw.id = $1
         LEFT JOIN content.venues v ON v.id = d.paid_venue_id
        WHERE ${where}
        ORDER BY (d.status = 'open') DESC, COALESCE(d.closed_at, d.created_at) DESC LIMIT 100`,
      [viewer, ...params],
    );
    return rows.map((r) => {
      const iOwe = r.debtor_id === viewer;
      const owedToMe = r.creditor_id === viewer;
      const open = r.status === 'open';
      const claimed = !!r.paid_claimed_at;
      // A prova (foto e local) só a veem as duas pessoas.
      const party = iOwe || owedToMe;
      return {
        id: r.id as string,
        debtor: personOf(r, 'db'),
        creditor: personOf(r, 'cr'),
        drink: maskFor({ slug: r.drink_slug, name: r.drink_name, category: r.drink_category, alcoholic: !!r.alcoholic }, !!r.viewer_adult),
        source: r.source as DebtDto['source'],
        status: r.status as DebtDto['status'],
        claimed: open && claimed,
        claimedAt: r.paid_claimed_at ? new Date(r.paid_claimed_at as string).toISOString() : null,
        photoUrl: party && r.paid_media_id ? `/api/v1/media/${r.paid_media_id as string}` : null,
        venue: party && r.venue_slug ? { slug: r.venue_slug as string, name: r.venue_name as string } : null,
        iOwe,
        owedToMe,
        canClaim: iOwe && open && !claimed,
        canConfirm: owedToMe && open && claimed,
        canForgive: owedToMe && open,
        at: new Date(r.created_at as string).toISOString(),
        closedAt: r.closed_at ? new Date(r.closed_at as string).toISOString() : null,
      };
    });
  }

  private async debt(viewer: string, id: string) {
    const [d] = await this.debts(viewer, 'd.id = $2 AND (d.debtor_id = $1 OR d.creditor_id = $1)', [id]);
    if (!d) throw new NotFoundException('Dívida não encontrada');
    return d;
  }

  /**
   * O livro das geladas de alguém, visto por mim. O meu: tudo. O de outra pessoa: se ela o mostra (definição da geleira) e eu
   * posso ver a geleira dela, o livro dela (sem quem tem bloqueio comigo); senão só as dívidas entre nós os dois.
   * `owe`/`owed`: quantas por pagar ela deve / lhe devem (no que eu vejo). `scope`: 'all' ou 'between'.
   */
  async book(viewer: string, username?: string) {
    let ownerId = viewer;
    let scope: 'all' | 'between' = 'all';
    if (username) {
      const o = (
        await this.pool.query(
          `SELECT u.id, u.gelada_book_public, ${geleiraShown('u', '$1')} AS shown, ${blockedBetween('u.id', '$1')} AS blocked
             FROM identity.users u WHERE lower(u.username) = lower($2) AND u.status = 'active'`,
          [viewer, username.replace(/^@/, '')],
        )
      ).rows[0];
      if (!o || o.blocked) throw new NotFoundException('Essa pessoa não existe');
      ownerId = o.id as string;
      if (ownerId !== viewer) scope = o.gelada_book_public && o.shown ? 'all' : 'between';
    }
    const other = `CASE WHEN d.debtor_id = $2 THEN d.creditor_id ELSE d.debtor_id END`;
    const where =
      scope === 'between'
        ? `((d.debtor_id = $2 AND d.creditor_id = $1) OR (d.creditor_id = $2 AND d.debtor_id = $1))`
        : `(d.debtor_id = $2 OR d.creditor_id = $2) AND (${other} = $1 OR $2 = $1 OR (
             EXISTS (SELECT 1 FROM identity.users ou WHERE ou.id = ${other} AND ou.status = 'active') AND NOT ${blockedBetween(other, '$1')}))`;
    const items = await this.debts(viewer, where, [ownerId]);
    const n = (
      await this.pool.query(
        `SELECT count(*) FILTER (WHERE d.debtor_id = $2)::int AS owe, count(*) FILTER (WHERE d.creditor_id = $2)::int AS owed
           FROM taste.gelada_debts d WHERE d.status = 'open' AND ${where}`,
        [viewer, ownerId],
      )
    ).rows[0];
    const owner = (await this.pool.query('SELECT gelada_book_public FROM identity.users WHERE id = $1', [ownerId])).rows[0];
    return {
      scope,
      /** O dono mostra o livro a quem vê a geleira (só o dono recebe este valor). */
      ...(ownerId === viewer ? { public: !!owner.gelada_book_public } : {}),
      owe: n.owe as number,
      owed: n.owed as number,
      items,
    };
  }

  /** «Fico a dever-te uma» (à mão): só o próprio devedor cria. A quem sigo ou me segue, sem bloqueio. */
  async oweManual(me: string, to: string, itemId: string) {
    const p = await this.userByName(to);
    if (p.id === me) throw new BadRequestException('Não podes ficar a dever a ti próprio');
    const ok = (
      await this.pool.query(
        `SELECT ${blockedBetween('$1::uuid', '$2::uuid')} AS blocked,
                EXISTS (SELECT 1 FROM social.follows f WHERE (f.follower_id = $1 AND f.followee_id = $2) OR (f.follower_id = $2 AND f.followee_id = $1)) AS linked`,
        [me, p.id],
      )
    ).rows[0];
    if (ok.blocked) throw new ForbiddenException('Não podes ficar a dever a esta pessoa');
    if (!ok.linked) throw new ForbiddenException('Só podes ficar a dever a quem segues ou te segue');
    const n = (await this.pool.query(`SELECT count(*)::int AS n FROM taste.gelada_debts WHERE debtor_id = $1 AND source = 'manual' AND created_at >= ${TODAY}`, [me])).rows[0].n as number;
    if (n >= MANUAL_DAY_MAX) throw new HttpException('Por hoje já chega de dívidas 😅', HttpStatus.TOO_MANY_REQUESTS);
    const iAmAdult = await this.adult(me);
    let d: DrinkRow = await this.drinkOf(me, itemId, iAmAdult);
    if (d.alcoholic && !p.adult) d = await this.softFor(me);
    const id = uuidv7();
    await this.pool.query(
      `INSERT INTO taste.gelada_debts (id, debtor_id, creditor_id, drink_slug, drink_name, drink_category, alcoholic, source) VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')`,
      [id, me, p.id, d.slug, d.name, d.category, d.alcoholic],
    );
    return this.debt(me, id);
  }

  /** O devedor diz «Já paguei», com uma foto (minha, já carregada) e/ou o local, se quiser. Fica à espera da confirmação. */
  async claimPaid(me: string, id: string, proof: { mediaId?: string; venueSlug?: string }) {
    let venueId: string | null = null;
    if (proof.mediaId) {
      const ok = await this.pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND owner_id = $2 AND status = 'ready' AND mime LIKE 'image/%'`, [proof.mediaId, me]);
      if (!ok.rowCount) throw new BadRequestException('Foto inválida ou ainda não carregada');
    }
    if (proof.venueSlug) {
      const v = await this.pool.query(`SELECT id FROM content.venues WHERE slug = $1 AND review_status = 'approved'`, [proof.venueSlug]);
      if (!v.rows[0]) throw new NotFoundException('Esse local não existe');
      venueId = v.rows[0].id as string;
    }
    const r = await this.pool.query(
      `UPDATE taste.gelada_debts SET paid_claimed_at = now(), paid_media_id = $3, paid_venue_id = $4
        WHERE id = $1 AND debtor_id = $2 AND status = 'open' AND paid_claimed_at IS NULL RETURNING creditor_id, alcoholic`,
      [id, me, proof.mediaId ?? null, venueId],
    );
    if (!r.rows[0]) await this.cannot(me, id, 'Esta dívida já não está por pagar');
    await this.notifications.notify({ userId: r.rows[0].creditor_id as string, actorId: me, kind: 'gelada_paid', data: { debtId: id, step: 'claimed', soft: !r.rows[0].alcoholic } });
    return this.debt(me, id);
  }

  /** Quem recebia confirma o «Já paguei»: fica paga (e conta para o nível da geleira dos dois). */
  async confirmPaid(me: string, id: string) {
    const r = await this.pool.query(
      `UPDATE taste.gelada_debts SET status = 'paid', closed_at = now() WHERE id = $1 AND creditor_id = $2 AND status = 'open' AND paid_claimed_at IS NOT NULL RETURNING debtor_id, alcoholic`,
      [id, me],
    );
    if (!r.rows[0]) await this.cannot(me, id, 'Ainda não te disseram que pagaram');
    await this.notifications.notify({ userId: r.rows[0].debtor_id as string, actorId: me, kind: 'gelada_paid', data: { debtId: id, step: 'confirmed', soft: !r.rows[0].alcoholic } });
    return this.debt(me, id);
  }

  /** Quem recebia diz que afinal não pagou: o «Já paguei» sai (a foto e o local também). */
  async rejectPaid(me: string, id: string) {
    const r = await this.pool.query(
      `UPDATE taste.gelada_debts SET paid_claimed_at = NULL, paid_media_id = NULL, paid_venue_id = NULL WHERE id = $1 AND creditor_id = $2 AND status = 'open' AND paid_claimed_at IS NOT NULL`,
      [id, me],
    );
    if (!r.rowCount) await this.cannot(me, id, 'Não há nada para recusar');
    return this.debt(me, id);
  }

  /** «Perdoar»: quem recebia fecha a dívida. */
  async forgive(me: string, id: string) {
    const r = await this.pool.query(`UPDATE taste.gelada_debts SET status = 'forgiven', closed_at = now() WHERE id = $1 AND creditor_id = $2 AND status = 'open'`, [id, me]);
    if (!r.rowCount) await this.cannot(me, id, 'Esta dívida já está fechada');
    return this.debt(me, id);
  }

  /** Não deu: 404 se a dívida não é minha (de nenhum dos lados), 403 se é do outro lado, senão 409 com o motivo. */
  private async cannot(me: string, id: string, why: string): Promise<never> {
    const d = (await this.pool.query('SELECT debtor_id, creditor_id FROM taste.gelada_debts WHERE id = $1', [id])).rows[0];
    if (!d || (d.debtor_id !== me && d.creditor_id !== me)) throw new NotFoundException('Dívida não encontrada');
    throw new ConflictException(why);
  }

  /* ───────────── rodadas ───────────── */

  private async roundRow(me: string, id: string) {
    const r = (await this.pool.query('SELECT r.*, gm.role FROM taste.gelada_rounds r JOIN social.group_members gm ON gm.group_id = r.group_id AND gm.user_id = $2 WHERE r.id = $1', [id, me])).rows[0];
    if (!r) throw new NotFoundException('Rodada não encontrada');
    return r as { id: string; group_id: string; opened_by: string; payer_id: string | null; status: string; role: string };
  }

  async round(me: string, id: string) {
    const [r] = await roundCards(this.pool, me, { ids: [id] });
    if (!r) throw new NotFoundException('Rodada não encontrada');
    return r;
  }

  /** A rodada mudou: os membros voltam a pedir a conversa do grupo (sem som). */
  private async roundChanged(groupId: string, me: string) {
    for (const u of await this.access.memberIds(groupId)) {
      if (u === me) this.events.echo(me, { type: 'edited', group: groupId });
      else this.events.emit(u, { type: 'edited', group: groupId });
    }
  }

  /** «Abrir rodada» no TxillGroup (qualquer membro; uma aberta de cada vez). O cartão aparece na conversa. */
  async openRound(me: string, groupId: string) {
    await this.access.needMember(groupId, me);
    const id = uuidv7();
    const msgId = uuidv7();
    try {
      await this.pool.query('INSERT INTO taste.gelada_rounds (id, group_id, opened_by, message_id) VALUES ($1, $2, $3, $4)', [id, groupId, me, msgId]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Já há uma rodada aberta neste grupo');
      throw e;
    }
    await this.access.postMessage(groupId, me, 'rodada', 'Abriu uma rodada! Quem entra? 🙌', 'abriu uma rodada. Quem entra?', msgId);
    return this.round(me, id);
  }

  /** «Eu entro», com a bebida (as com álcool só para quem tem 18 anos). Mudar de bebida é entrar outra vez. */
  async joinRound(me: string, id: string, itemId: string) {
    const r = await this.roundRow(me, id);
    if (r.status !== 'open') throw new ConflictException('Esta rodada já fechou');
    const d = await this.drinkOf(me, itemId, await this.adult(me));
    await this.pool.query(
      `INSERT INTO taste.gelada_round_entries (round_id, user_id, drink_slug, drink_name, drink_category, alcoholic) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (round_id, user_id) DO UPDATE SET drink_slug = EXCLUDED.drink_slug, drink_name = EXCLUDED.drink_name, drink_category = EXCLUDED.drink_category, alcoholic = EXCLUDED.alcoholic`,
      [id, me, d.slug, d.name, d.category, d.alcoholic],
    );
    await this.roundChanged(r.group_id, me);
    return this.round(me, id);
  }

  /** Sair da rodada (e, se era eu a pagar, deixo de pagar). */
  async leaveRound(me: string, id: string) {
    const r = await this.roundRow(me, id);
    if (r.status !== 'open') throw new ConflictException('Esta rodada já fechou');
    await this.pool.query('DELETE FROM taste.gelada_round_entries WHERE round_id = $1 AND user_id = $2', [id, me]);
    await this.pool.query('UPDATE taste.gelada_rounds SET payer_id = NULL WHERE id = $1 AND payer_id = $2', [id, me]);
    await this.roundChanged(r.group_id, me);
    return this.round(me, id);
  }

  /** «Esta pago eu» (on) ou desistir de pagar. Só um paga: se já há outra pessoa, 409. */
  async payRound(me: string, id: string, on: boolean) {
    const r = await this.roundRow(me, id);
    if (r.status !== 'open') throw new ConflictException('Esta rodada já fechou');
    if (on) {
      const u = await this.pool.query('UPDATE taste.gelada_rounds SET payer_id = $2 WHERE id = $1 AND (payer_id IS NULL OR payer_id = $2) AND status = \'open\'', [id, me]);
      if (!u.rowCount) {
        const who = (await this.pool.query('SELECT u.username FROM taste.gelada_rounds r JOIN identity.users u ON u.id = r.payer_id WHERE r.id = $1', [id])).rows[0];
        throw new ConflictException(`Esta já é paga por @${who?.username ?? 'outra pessoa'}`);
      }
    } else {
      await this.pool.query('UPDATE taste.gelada_rounds SET payer_id = NULL WHERE id = $1 AND payer_id = $2', [id, me]);
    }
    await this.roundChanged(r.group_id, me);
    return this.round(me, id);
  }

  /**
   * Fechar a rodada (quem abriu, quem paga ou quem administra). Fica no histórico de quem pagou. `bill`: quem pagou pede que cada
   * um que bebeu lhe fique a dever a sua bebida (só quem paga o pode pedir).
   */
  async closeRound(me: string, id: string, bill: boolean) {
    const r = await this.roundRow(me, id);
    if (r.status !== 'open') throw new ConflictException('Esta rodada já fechou');
    if (r.opened_by !== me && r.payer_id !== me && r.role !== 'admin') throw new ForbiddenException('Só quem abriu, quem paga ou quem administra fecha a rodada');
    if (bill && r.payer_id !== me) throw new ForbiddenException('Só quem pagou pode pôr a rodada no livro');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(`UPDATE taste.gelada_rounds SET status = 'closed', closed_at = now() WHERE id = $1 AND status = 'open' RETURNING payer_id`, [id]);
      if (!upd.rowCount) throw new ConflictException('Esta rodada já fechou');
      if (bill) {
        await client.query(
          `INSERT INTO taste.gelada_debts (id, debtor_id, creditor_id, drink_slug, drink_name, drink_category, alcoholic, source, round_id)
           SELECT gen_random_uuid(), e.user_id, $2, e.drink_slug, e.drink_name, e.drink_category, e.alcoholic, 'round', $1
             FROM taste.gelada_round_entries e JOIN identity.users u ON u.id = e.user_id
            WHERE e.round_id = $1 AND e.user_id <> $2 AND u.status = 'active' AND NOT ${blockedBetween('e.user_id', '$2')}`,
          [id, me],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    await this.roundChanged(r.group_id, me);
    return this.round(me, id);
  }
}
