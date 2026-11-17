import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Pool } from 'pg';
import { badge, tierOf } from '../common/badge';
import { TOPICS, topicLabel } from '../common/topics';
import { PG_POOL } from '../db/db.module';
import { InstantsService } from '../instants/instants.service';
import { recapRange } from '../instants/zas-recap-card';
import { MediaService } from '../media/media.service';
import { PostsService } from '../posts/posts.service';
import { StoriesService } from '../stories/stories.service';
import { MAX_PRIVATE, notOffSql, privateTopicsOf, privateTopicsOfAll, mixarOffTopics, type TopicMode } from './mixar-controlo';
import { mixarDay, prevDay, streakOf } from './mixar-pick';
import { renderWeekCard, WEEK_OUT } from './mixar-week-card';
import { bothSee, MixarService, seeAll, type FeedPost, type ReactionId, type Row } from './mixar.service';

type Topic = { topic: string; label: string };
const KNOWN = new Set(TOPICS.map((t) => t.id));
const label = (t: string): Topic => ({ topic: t, label: topicLabel(t) });
/** O catálogo dos temas, por ordem alfabética do nome. */
const CATALOG: Topic[] = TOPICS.map((t) => ({ topic: t.id, label: t.label })).sort((a, b) => a.label.localeCompare(b.label, 'pt'));
/** Quantos dias tem o resumo (o de hoje e os 6 anteriores, em dias do Mixar). */
export const WEEK_DAYS = 7;

export interface MixarTopicsDto {
  /** O que eu escolhi neste Mixar: 'less' («Menos disto») ou 'off' («Não quero isto no nosso Mixar»). */
  mine: (Topic & { mode: TopicMode })[];
  /** Os temas que o outro tirou deste Mixar (saem para os dois; só quem tirou volta a pôr). */
  theirsOff: Topic[];
  /** De quantos autores pedi «menos» neste Mixar. */
  lessAuthors: number;
  /** Todos os temas (para tirar um que ainda não apareceu). */
  all: Topic[];
}

export interface MixarWeekDto {
  /** O primeiro e o último dia (dias do Mixar, 'YYYY-MM-DD') e «10 a 16 nov». */
  from: string;
  to: string;
  label: string;
  /** Hoje é segunda-feira (no dia do Mixar): a app mostra o cartão no fim do feed. */
  recapDay: boolean;
  /** O item mais reagido pelos dois (sem «nah»), se houver e se os dois ainda o podem ver. */
  top: { post: FeedPost; mine: ReactionId | null; theirs: ReactionId | null } | null;
  /** Os desafios da semana: quantos houve, quantos os dois jogaram e em quantos escolheram o mesmo. */
  challenge: { offered: number; played: number; matches: number };
  streak: number;
  /** Os temas da semana (até 5), sem os privados de nenhum dos dois nem os tirados do Mixar. */
  topics: Topic[];
  /** Vídeos da semana que pelo menos um dos dois viu, e que os dois viram. */
  videos: number;
  together: number;
  /** O outro deixa partilhar o resumo (0179, «Deixar que o resumo da semana me inclua»). Falso: sem imagem nem partilha. */
  shareable: boolean;
}

/**
 * Controlo e resumo do Mixar (0172, docs/mixar-contrato.md, «Controlo e resumo»): afinar os temas de um Mixar («Menos
 * disto» num item; tirar e voltar a pôr um tema), os temas privados de cada pessoa (valem para todos os Mixar dela) e o
 * resumo da semana (com a partilha do cartão no Zás ou nos mimos). A geração respeita isto em mixar.service.ts, pelas
 * funções de mixar-controlo.ts.
 */
@Injectable()
export class MixarControloService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly mixar: MixarService,
    private readonly posts: PostsService,
    private readonly media: MediaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /* ───────────── temas deste Mixar ───────────── */

  async topics(me: string, id: string): Promise<MixarTopicsDto> {
    const m = await this.mixar.active(me, id);
    return this.topicsDto(me, m);
  }

  /** Muda um tema meu neste Mixar: 'less', 'off' ou `null` (volta ao normal). */
  async setTopic(me: string, id: string, topic: string, mode: TopicMode | null): Promise<MixarTopicsDto> {
    const m = await this.mixar.active(me, id);
    if (!KNOWN.has(topic)) throw new BadRequestException('Tema desconhecido');
    if (mode === null) await this.pool.query('DELETE FROM social.mixar_topic_prefs WHERE mixar_id = $1 AND user_id = $2 AND topic = $3', [id, me, topic]);
    else {
      await this.pool.query(
        `INSERT INTO social.mixar_topic_prefs (mixar_id, user_id, topic, mode) VALUES ($1, $2, $3, $4)
         ON CONFLICT (mixar_id, user_id, topic) DO UPDATE SET mode = EXCLUDED.mode, created_at = now()`,
        [id, me, topic, mode],
      );
    }
    return this.topicsDto(me, m);
  }

  /**
   * «Menos disto» num item: o tema do item (a razão; sem ela, o primeiro tema da publicação) passa a 'less' neste Mixar (um
   * 'off' fica 'off') e o autor também pesa menos. Só para itens deste Mixar que os dois podem ver.
   */
  async less(me: string, id: string, postId: string) {
    const m = await this.mixar.active(me, id);
    const r = (
      await this.pool.query(
        `SELECT p.author_id, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.verified, u.verified_tier,
                COALESCE((SELECT i.topic FROM social.mixar_items i WHERE i.mixar_id = $3 AND i.post_id = p.id AND i.topic IS NOT NULL ORDER BY i.day DESC LIMIT 1), p.topics[1]) AS topic
           FROM content.posts p JOIN identity.users u ON u.id = p.author_id
          WHERE p.id = $2 AND EXISTS (SELECT 1 FROM social.mixar_items i WHERE i.mixar_id = $3 AND i.post_id = p.id) AND ${seeAll('$1')}`,
        [[me, ...m.others], postId, id],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Publicação não encontrada neste Mixar');
    // Um tema privado de um dos dois não se mostra nem se guarda pelo item (a escolha fica só no autor).
    const hidden = await privateTopicsOfAll(this.pool, [me, ...m.others]);
    const topic = r.topic && KNOWN.has(r.topic as string) && !hidden.has(r.topic as string) ? (r.topic as string) : null;
    if (topic) {
      await this.pool.query(
        `INSERT INTO social.mixar_topic_prefs (mixar_id, user_id, topic, mode) VALUES ($1, $2, $3, 'less')
         ON CONFLICT (mixar_id, user_id, topic) DO UPDATE SET created_at = now()`,
        [id, me, topic],
      );
    }
    await this.pool.query(
      `INSERT INTO social.mixar_author_less (mixar_id, user_id, author_id) VALUES ($1, $2, $3) ON CONFLICT (mixar_id, user_id, author_id) DO UPDATE SET created_at = now()`,
      [id, me, r.author_id],
    );
    return {
      topic: topic ? label(topic) : null,
      author: { username: r.username as string, displayName: r.display_name as string, hasAvatar: !!r.has_avatar, ...badge(r.verified, r.verified_tier) },
      topics: await this.topicsDto(me, m),
    };
  }

  private async topicsDto(me: string, m: Row): Promise<MixarTopicsDto> {
    const [prefs, authors] = await Promise.all([
      this.pool.query('SELECT user_id, topic, mode FROM social.mixar_topic_prefs WHERE mixar_id = $1 ORDER BY created_at DESC', [m.id]),
      this.pool.query('SELECT count(*)::int AS n FROM social.mixar_author_less WHERE mixar_id = $1 AND user_id = $2', [m.id, me]),
    ]);
    return {
      mine: prefs.rows.filter((r) => r.user_id === me).map((r) => ({ ...label(r.topic as string), mode: r.mode as TopicMode })),
      theirsOff: prefs.rows.filter((r) => r.user_id !== me && r.mode === 'off').map((r) => label(r.topic as string)),
      lessAuthors: authors.rows[0].n as number,
      all: CATALOG,
    };
  }

  /* ───────────── temas privados (por pessoa) ───────────── */

  async privateTopics(me: string): Promise<{ topics: Topic[]; all: Topic[] }> {
    const mine = await privateTopicsOf(this.pool, me);
    return { topics: CATALOG.filter((t) => mine.has(t.topic)), all: CATALOG };
  }

  /** Substitui a lista dos meus temas privados. */
  async setPrivateTopics(me: string, topics: string[]) {
    const list = [...new Set(topics)];
    if (list.some((t) => !KNOWN.has(t))) throw new BadRequestException('Tema desconhecido');
    if (list.length > MAX_PRIVATE) throw new BadRequestException(`No máximo ${MAX_PRIVATE} temas privados`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM social.mixar_private_topics WHERE user_id = $1 AND NOT (topic = ANY($2::text[]))', [me, list]);
      if (list.length) {
        await client.query('INSERT INTO social.mixar_private_topics (user_id, topic) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [me, list]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return this.privateTopics(me);
  }

  /* ───────────── resumo da semana ───────────── */

  async week(me: string, id: string, now: Date = new Date()): Promise<MixarWeekDto> {
    const m = await this.mixar.active(me, id);
    if (m.group_id) throw new NotFoundException('O resumo da semana ainda não existe no Mixar de grupo');
    const to = mixarDay(now);
    let from = to;
    for (let i = 1; i < WEEK_DAYS; i++) from = prevDay(from);
    const [hidden, off, theirChoice] = await Promise.all([
      privateTopicsOfAll(this.pool, [me, m.other_id]),
      mixarOffTopics(this.pool, id),
      this.pool.query('SELECT mixar_week_include FROM identity.users WHERE id = $1', [m.other_id]),
    ]);

    // O mais reagido pelos dois: os dois reagiram primeiro, depois quantas reações (sem «nah»), depois o mais recente.
    const topRow = (
      await this.pool.query(
        `SELECT p.id,
                max(r.reaction) FILTER (WHERE r.user_id = $1) AS mine, max(r.reaction) FILTER (WHERE r.user_id = $2) AS theirs,
                count(*) FILTER (WHERE r.reaction <> 'nah') AS n, count(DISTINCT r.user_id) FILTER (WHERE r.reaction <> 'nah') AS who, max(r.created_at) AS last
           FROM social.mixar_reactions r JOIN content.posts p ON p.id = r.post_id JOIN identity.users u ON u.id = p.author_id
          WHERE r.mixar_id = $3 AND r.user_id IN ($1, $2)
            AND EXISTS (SELECT 1 FROM social.mixar_items i WHERE i.mixar_id = r.mixar_id AND i.post_id = r.post_id AND i.day BETWEEN $4::date AND $5::date)
            AND ${bothSee('$1', '$2')} AND ${notOffSql('r.mixar_id')}
          GROUP BY p.id
         HAVING count(*) FILTER (WHERE r.reaction <> 'nah') > 0
          ORDER BY who DESC, n DESC, last DESC, p.id LIMIT 1`,
        [me, m.other_id, id, from, to],
      )
    ).rows[0];
    let top: MixarWeekDto['top'] = null;
    if (topRow) {
      const [post] = await this.posts.feedPosts(me, [topRow.id as string]);
      if (post) top = { post, mine: (topRow.mine as ReactionId | null) ?? null, theirs: (topRow.theirs as ReactionId | null) ?? null };
    }

    const [ch, games, seen, tw] = await Promise.all([
      this.pool.query(
        `SELECT count(*)::int AS offered,
                count(*) FILTER (WHERE x.picks = 2)::int AS played,
                count(*) FILTER (WHERE x.picks = 2 AND x.distinct_picks = 1)::int AS matches
           FROM (SELECT ch.id, count(k.user_id) AS picks, count(DISTINCT k.post_id) AS distinct_picks
                   FROM social.mixar_challenges ch LEFT JOIN social.mixar_picks k ON k.challenge_id = ch.id
                  WHERE ch.mixar_id = $1 AND ch.day BETWEEN $2::date AND $3::date GROUP BY ch.id) x`,
        [id, from, to],
      ),
      this.pool.query(
        `SELECT ch.day::text AS day FROM social.mixar_challenges ch JOIN social.mixar_picks k ON k.challenge_id = ch.id
          WHERE ch.mixar_id = $1 GROUP BY ch.id, ch.day HAVING count(*) = 2`,
        [id],
      ),
      this.pool.query(
        `SELECT count(*)::int AS videos, count(*) FILTER (WHERE x.who = 2)::int AS together
           FROM (SELECT v.post_id, count(DISTINCT v.user_id) AS who
                   FROM social.mixar_views v JOIN content.posts p ON p.id = v.post_id
                  WHERE v.mixar_id = $1 AND v.user_id IN ($2, $3)
                    AND EXISTS (SELECT 1 FROM social.mixar_items i WHERE i.mixar_id = v.mixar_id AND i.post_id = v.post_id AND i.day BETWEEN $4::date AND $5::date)
                    AND (SELECT bool_or(ma.mime LIKE 'video/%') FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id WHERE pm.post_id = p.id)
                  GROUP BY v.post_id) x`,
        [id, me, m.other_id, from, to],
      ),
      // Os temas da semana: o que os dois fizeram com os itens da semana (reações, vistos até ao fim, envios para o chat);
      // sem nada disso, os temas dos itens que viram.
      this.pool.query(
        `SELECT topic, sum(wt) AS wt FROM (
           SELECT unnest(p.topics) AS topic, CASE WHEN r.reaction = 'nah' THEN -1.0 ELSE 1.5 END AS wt
             FROM social.mixar_reactions r JOIN content.posts p ON p.id = r.post_id
            WHERE r.mixar_id = $1 AND EXISTS (SELECT 1 FROM social.mixar_items i WHERE i.mixar_id = r.mixar_id AND i.post_id = r.post_id AND i.day BETWEEN $2::date AND $3::date)
           UNION ALL
           SELECT unnest(p.topics), (CASE WHEN v.done THEN 1.0 ELSE 0.2 END + CASE WHEN v.shared_at IS NOT NULL THEN 2.0 ELSE 0 END)
             FROM social.mixar_views v JOIN content.posts p ON p.id = v.post_id
            WHERE v.mixar_id = $1 AND EXISTS (SELECT 1 FROM social.mixar_items i WHERE i.mixar_id = v.mixar_id AND i.post_id = v.post_id AND i.day BETWEEN $2::date AND $3::date)
         ) x GROUP BY topic HAVING sum(wt) > 0 ORDER BY sum(wt) DESC, topic LIMIT 20`,
        [id, from, to],
      ),
    ]);
    const topics = tw.rows
      .map((r) => r.topic as string)
      .filter((t) => KNOWN.has(t) && !hidden.has(t) && !off.has(t))
      .slice(0, 5)
      .map(label);

    return {
      from,
      to,
      label: recapRange(from, to),
      recapDay: new Date(`${to}T12:00:00Z`).getUTCDay() === 1,
      top,
      challenge: ch.rows[0] as MixarWeekDto['challenge'],
      streak: streakOf(games.rows.map((r) => r.day as string), to),
      topics,
      videos: seen.rows[0].videos as number,
      together: seen.rows[0].together as number,
      shareable: theirChoice.rows[0]?.mixar_week_include !== false,
    };
  }

  /** O cartão da semana em JPEG (o mesmo que se partilha). Sem temas privados de nenhum dos dois. 403 se o outro não deixa. */
  async weekImage(me: string, id: string): Promise<Buffer> {
    const m = await this.mixar.active(me, id);
    const w = await this.week(me, id);
    // Quem desligou «Deixar que o resumo da semana me inclua» (0179) não aparece nos resumos que os outros partilham.
    // A app diz o nome do outro (pelo `code`).
    if (!w.shareable) throw new ForbiddenException({ statusCode: 403, message: 'A outra pessoa não deixa partilhar o resumo da semana do vosso Mixar', code: 'mixar_week_not_shareable' });
    const u = (await this.pool.query('SELECT username, verified, verified_tier FROM identity.users WHERE id = $1', [me])).rows[0];
    const mySeal = tierOf(u.verified, u.verified_tier);
    return renderWeekCard({
      label: w.label,
      me: { name: m.my_first, seal: mySeal },
      them: { name: m.their_first, seal: tierOf(m.verified, m.verified_tier) },
      username: u.username as string,
      mySeal,
      streak: w.streak,
      challenge: w.challenge,
      videos: w.videos,
      topics: w.topics.map((t) => t.label),
    });
  }

  /**
   * Partilhar o cartão da semana: no Zás (para os amigos, como qualquer Zás) ou nos mimos (para os amigos ou só os amigos
   * próximos). A imagem é desenhada aqui, já assinada.
   */
  async shareWeek(me: string, id: string, to: 'zas' | 'story', audience: 'all' | 'close' = 'all'): Promise<{ to: 'zas' | 'story'; id: string }> {
    const jpg = await this.weekImage(me, id);
    const size = { signed: true, width: WEEK_OUT.W, height: WEEK_OUT.H };
    if (to === 'zas') {
      const mediaId = await this.media.storeDerived(me, jpg, 'image/jpeg', 'chat', null, size);
      const z = await this.moduleRef.get(InstantsService, { strict: false }).create(me, mediaId, '', audience === 'close' ? 'close' : 'friends');
      return { to, id: z.id };
    }
    const mediaId = await this.media.storeDerived(me, jpg, 'image/jpeg', 'public', null, size);
    const s = (await this.moduleRef.get(StoriesService, { strict: false }).create(me, mediaId, '', audience === 'close' ? 'close_friends' : 'all')) as { id: string };
    return { to, id: s.id };
  }
}
