import { Global, Inject, Injectable, Logger, Module, OnModuleInit, Optional } from '@nestjs/common';
import type { Client } from '@elastic/elasticsearch';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';

export const ES_CLIENT = Symbol('ES_CLIENT');

/** Português sem acentos, com radicais ("praias" acha "praia") e nomes por prefixo (escrever "mar" acha "Margarida"). */
const SETTINGS = {
  number_of_shards: 1,
  number_of_replicas: 0,
  analysis: {
    filter: {
      pt_stop: { type: 'stop', stopwords: '_portuguese_' },
      pt_stem: { type: 'stemmer', language: 'light_portuguese' },
      edge: { type: 'edge_ngram', min_gram: 2, max_gram: 20 },
    },
    analyzer: {
      pt: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding', 'pt_stop', 'pt_stem'] },
      name_edge: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding', 'edge'] },
      name_search: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
    },
    normalizer: { lower: { type: 'custom', filter: ['lowercase', 'asciifolding'] } },
  },
} as const;

const POSTS_MAPPING = {
  properties: {
    body: { type: 'text', analyzer: 'pt' },
    location: { type: 'text', analyzer: 'pt' },
    tags: { type: 'keyword' },
    author_id: { type: 'keyword' },
    created_at: { type: 'date' },
  },
} as const;

const USERS_MAPPING = {
  properties: {
    username: { type: 'text', analyzer: 'name_edge', search_analyzer: 'name_search', fields: { raw: { type: 'keyword', normalizer: 'lower' } } },
    display_name: { type: 'text', analyzer: 'name_edge', search_analyzer: 'name_search' },
    followers: { type: 'integer' },
  },
} as const;

/**
 * Índice de pesquisa em Elasticsearch (opcional). O Elasticsearch só diz QUAIS são os resultados mais relevantes
 * (ids); quem pode vê-los continua a decidir o PostgreSQL (privacidade, bloqueios, contas eliminadas).
 * Assim um erro de sincronização nunca expõe conteúdo privado.
 *
 * A indexação é em segundo plano e com repetição; se o Elasticsearch falhar, a pesquisa cai para o PostgreSQL.
 */
@Injectable()
export class SearchIndexer implements OnModuleInit {
  private readonly log = new Logger('SearchIndex');
  readonly enabled: boolean;
  private readonly posts: string;
  private readonly users: string;
  private jobs = new Map<string, () => Promise<void>>();
  private running: Promise<void> | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    @Optional() @Inject(ES_CLIENT) private readonly client?: Client | null,
  ) {
    this.enabled = config.SEARCH_BACKEND === 'elasticsearch' && !!client;
    this.posts = `${config.ELASTICSEARCH_INDEX_PREFIX}-posts`;
    this.users = `${config.ELASTICSEARCH_INDEX_PREFIX}-users`;
  }

  async onModuleInit() {
    if (this.enabled) await this.ensureIndices().catch((e) => this.log.error(`não consegui preparar os índices: ${(e as Error).message}`));
  }

  async ensureIndices() {
    const c = this.client!;
    for (const [index, mappings] of [[this.posts, POSTS_MAPPING], [this.users, USERS_MAPPING]] as const) {
      if (!(await c.indices.exists({ index }))) await c.indices.create({ index, settings: SETTINGS as never, mappings: mappings as never });
    }
  }

  /* ───────────── fila: junta pedidos repetidos e tenta de novo ───────────── */

  private enqueue(key: string, job: () => Promise<void>) {
    if (!this.enabled) return;
    this.jobs.set(key, job); // o mais recente por chave ganha
    this.running ??= this.loop().finally(() => (this.running = null));
  }

  private async loop() {
    while (this.jobs.size) {
      const [key, job] = this.jobs.entries().next().value as [string, () => Promise<void>];
      this.jobs.delete(key);
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await job();
          break;
        } catch (e) {
          if (attempt === 3) this.log.error(`falha a indexar ${key}: ${(e as Error).message}`);
          else await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
        }
      }
    }
  }

  /** Espera que a fila esvazie (testes e scripts). */
  async drain() {
    while (this.running) await this.running;
  }

  /* ───────────── o que se indexa ───────────── */

  postChanged(id: string) {
    this.enqueue(`post:${id}`, async () => {
      const { rows } = await this.pool.query(
        `SELECT p.id, p.body, p.location_label, p.created_at, p.author_id, p.removed_at, p.kind, u.status,
                COALESCE((SELECT array_agg(t.tag) FROM content.post_tags t WHERE t.post_id = p.id), '{}') AS tags
           FROM content.posts p JOIN identity.users u ON u.id = p.author_id WHERE p.id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r || r.removed_at || r.status !== 'active' || r.kind === 'gift') return void (await this.client!.delete({ index: this.posts, id }, { ignore: [404] }));
      await this.client!.index({ index: this.posts, id, document: { body: r.body, location: r.location_label ?? '', tags: r.tags, author_id: r.author_id, created_at: r.created_at } });
    });
  }

  postRemoved(id: string) {
    this.enqueue(`post:${id}`, async () => void (await this.client!.delete({ index: this.posts, id }, { ignore: [404] })));
  }

  userChanged(id: string) {
    this.enqueue(`user:${id}`, async () => {
      const { rows } = await this.pool.query(
        `SELECT u.username, u.display_name, u.status, (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers FROM identity.users u WHERE u.id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r || r.status !== 'active') return void (await this.client!.delete({ index: this.users, id }, { ignore: [404] }));
      await this.client!.index({ index: this.users, id, document: { username: r.username, display_name: r.display_name, followers: r.followers } });
    });
  }

  /** Conta eliminada: sai o perfil e todas as publicações dela. */
  userRemoved(id: string) {
    this.enqueue(`user:${id}`, async () => {
      await this.client!.delete({ index: this.users, id }, { ignore: [404] });
      await this.client!.deleteByQuery({ index: this.posts, query: { term: { author_id: id } }, refresh: false, conflicts: 'proceed' });
    });
  }

  /** Reconstrói os índices a partir do PostgreSQL (primeira vez, ou se algo se desalinhou). */
  async reindexAll() {
    await this.ensureIndices();
    const c = this.client!;
    let n = 0;
    let last = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const { rows } = await this.pool.query(
        `SELECT p.id, p.body, p.location_label, p.created_at, p.author_id,
                COALESCE((SELECT array_agg(t.tag) FROM content.post_tags t WHERE t.post_id = p.id), '{}') AS tags
           FROM content.posts p JOIN identity.users u ON u.id = p.author_id
          WHERE p.removed_at IS NULL AND u.status = 'active' AND p.kind <> 'gift' AND p.id > $1 ORDER BY p.id LIMIT 500`,
        [last],
      );
      if (!rows.length) break;
      await c.bulk({ refresh: false, operations: rows.flatMap((r) => [{ index: { _index: this.posts, _id: r.id } }, { body: r.body, location: r.location_label ?? '', tags: r.tags, author_id: r.author_id, created_at: r.created_at }]) });
      last = rows[rows.length - 1].id;
      n += rows.length;
    }
    last = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const { rows } = await this.pool.query(
        `SELECT u.id, u.username, u.display_name, (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers
           FROM identity.users u WHERE u.status = 'active' AND u.id > $1 ORDER BY u.id LIMIT 500`,
        [last],
      );
      if (!rows.length) break;
      await c.bulk({ refresh: false, operations: rows.flatMap((r) => [{ index: { _index: this.users, _id: r.id } }, { username: r.username, display_name: r.display_name, followers: r.followers }]) });
      last = rows[rows.length - 1].id;
      n += rows.length;
    }
    await c.indices.refresh({ index: [this.posts, this.users] });
    return n;
  }

  /* ───────────── pesquisa ───────────── */

  /** Ids de publicações, da mais relevante para a menos (com um bónus para as recentes). */
  async searchPosts(term: string, size: number): Promise<string[]> {
    const r = await this.client!.search({
      index: this.posts,
      size,
      _source: false,
      query: {
        function_score: {
          query: {
            bool: {
              should: [
                { multi_match: { query: term, fields: ['body^2', 'location'], operator: 'and', fuzziness: 'AUTO' } },
                { match_phrase_prefix: { body: { query: term, max_expansions: 30 } } },
                { term: { tags: term.replace(/^#/, '').toLowerCase() } },
              ],
              minimum_should_match: 1,
            },
          },
          functions: [{ gauss: { created_at: { origin: 'now', scale: '14d', decay: 0.5 } } }],
          boost_mode: 'multiply',
        },
      },
    });
    return r.hits.hits.map((h) => String(h._id));
  }

  /** Ids de pessoas: nome ou @ por prefixo, com tolerância a erros de escrita e preferência por quem tem mais seguidores. */
  async searchUsers(term: string, size: number): Promise<string[]> {
    const r = await this.client!.search({
      index: this.users,
      size,
      _source: false,
      query: {
        function_score: {
          query: {
            bool: {
              should: [
                { term: { 'username.raw': { value: term.toLowerCase(), boost: 8 } } },
                { match: { username: { query: term, operator: 'and', boost: 3 } } },
                { match: { display_name: { query: term, operator: 'and', boost: 2 } } },
                { match: { display_name: { query: term, fuzziness: 'AUTO', prefix_length: 1 } } },
              ],
              minimum_should_match: 1,
            },
          },
          functions: [{ field_value_factor: { field: 'followers', modifier: 'log1p', missing: 0, factor: 0.4 } }],
          boost_mode: 'sum',
        },
      },
    });
    return r.hits.hits.map((h) => String(h._id));
  }
}

@Global()
@Module({
  providers: [SearchIndexer],
  exports: [SearchIndexer],
})
export class SearchIndexModule {}
