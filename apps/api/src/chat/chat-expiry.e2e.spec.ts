import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ChatExpiryService } from './chat-expiry.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const MIGRATION = '0123_mensagens_temporarias_e_limpar.sql';

interface U { token: string; id: string; username: string }

/**
 * Riscos da limpeza das mensagens temporárias (ChatExpiryService, de 5 em 5 minutos) e da migração 0123:
 * - nunca apaga mensagens sem `expires_at` (nem as que ainda não passaram, nem os avisos de sistema);
 * - respeita o limite por volta e a seleção usa o índice parcial messages_expires_idx (sem varrer a tabela toda);
 * - um presente expirado fica como linha vazia (gift_tx) e não volta a ser apanhado; o dinheiro não mexe;
 * - conta eliminada: as mensagens dela já saem com a conta; as dos outros no mesmo grupo expiram sem partir a limpeza;
 * - a 0123 a correr duas vezes não parte (o migrate salta-a; o SQL repetido falha inteiro, sem meias mudanças).
 */
describe('limpeza das mensagens temporárias e migração 0123 (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let expiry: ChatExpiryService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  let conv = '';

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  /** Mete uma mensagem diretamente na conversa a dois (de xa para xb), com o `expires_at` dado (SQL). */
  async function raw(expires: string, extra: { kind?: string; body?: string; gift?: boolean; system?: boolean; group?: string; sender?: string } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO social.messages (id, conversation_id, group_id, sender_id, body, kind, gift_tx, gift_amount, system, expires_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CASE WHEN $6 THEN gen_random_uuid() END, CASE WHEN $6 THEN 5 END,
               CASE WHEN $7 THEN '{"type":"ttl","ttl":86400,"name":"xa"}'::jsonb END, ${expires}) RETURNING id`,
      [extra.group ? null : conv, extra.group ?? null, extra.sender ?? u.xa.id, extra.body ?? 'olá', extra.kind ?? 'text', !!extra.gift, !!extra.system],
    );
    return rows[0].id as string;
  }
  const row = async (id: string) => (await pool.query('SELECT id, body, kind, deleted_at, expires_at, gift_tx FROM social.messages WHERE id = $1', [id])).rows[0];

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    expiry = app.get(ChatExpiryService);
    for (const n of ['xa', 'xb', 'xc']) u[n] = await signup(n);
    for (const a of Object.values(u)) for (const b of Object.values(u)) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
    await api().post(`/api/v1/chat/with/${u.xb.username}`).set(auth(u.xa)).send({ body: 'abre a conversa' }).expect(201);
    conv = (await pool.query('SELECT id FROM social.conversations WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)', [u.xa.id, u.xb.id])).rows[0].id as string;
    // Deixa a tabela sem expiradas de outros testes (as contas a seguir comparam números exatos).
    while ((await expiry.run()) > 0) { /* esvazia */ }
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('só apaga as que passaram do expires_at: as sem expires_at, as que ainda não chegaram lá e os avisos de sistema ficam', async () => {
    const keep = await raw('NULL', { body: 'fica para sempre' });
    const future = await raw("now() + interval '1 day'", { body: 'ainda não' });
    const notice = await raw('NULL', { kind: 'system', body: 'xa ligou as mensagens temporárias: 24 horas.', system: true });
    const justNow = await raw("now() + interval '2 seconds'", { body: 'quase' });
    const past1 = await raw("now() - interval '1 minute'", { body: 'já foi 1' });
    const past2 = await raw("now() - interval '3 days'", { body: 'já foi 2' });
    const before = (await pool.query('SELECT count(*)::int AS n FROM social.messages WHERE expires_at IS NULL')).rows[0].n as number;

    expect(await expiry.run()).toBe(2);
    expect(await row(past1)).toBeUndefined();
    expect(await row(past2)).toBeUndefined();
    for (const [id, body] of [[keep, 'fica para sempre'], [future, 'ainda não'], [notice, 'xa ligou as mensagens temporárias: 24 horas.'], [justNow, 'quase']]) {
      expect(await row(id)).toMatchObject({ body, deleted_at: null });
    }
    expect((await row(notice)).kind).toBe('system');
    // Nenhuma linha sem expires_at saiu (em toda a tabela).
    expect((await pool.query('SELECT count(*)::int AS n FROM social.messages WHERE expires_at IS NULL')).rows[0].n).toBe(before);
    // A que estava quase passa a ir na volta seguinte; as outras continuam.
    await pool.query("UPDATE social.messages SET expires_at = now() - interval '1 second' WHERE id = $1", [justNow]);
    expect(await expiry.run()).toBe(1);
    expect(await row(justNow)).toBeUndefined();
    expect(await row(keep)).toBeDefined();
    expect(await row(future)).toBeDefined();
    expect(await expiry.run()).toBe(0);
  });

  it('respeita o limite por volta (as que sobram ficam para a seguinte) e escolhe as mais antigas primeiro', async () => {
    const oldest = await raw("now() - interval '10 days'");
    const mid = await raw("now() - interval '5 days'");
    const newest = await raw("now() - interval '1 minute'");
    expect(await expiry.run(2)).toBe(2);
    expect(await row(oldest)).toBeUndefined();
    expect(await row(mid)).toBeUndefined();
    expect(await row(newest)).toBeDefined();
    expect(await expiry.run(2)).toBe(1);
    expect(await row(newest)).toBeUndefined();
  });

  it('a seleção da limpeza usa o índice parcial messages_expires_idx, mesmo com muitas mensagens sem expires_at', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // 30 000 mensagens normais e 50 temporárias (expiradas e por expirar), só nesta transação.
      await c.query(`INSERT INTO social.messages (id, conversation_id, sender_id, body) SELECT gen_random_uuid(), $1, $2, 'x' FROM generate_series(1, 30000)`, [conv, u.xa.id]);
      await c.query(`INSERT INTO social.messages (id, conversation_id, sender_id, body, expires_at) SELECT gen_random_uuid(), $1, $2, 'y', now() + (g - 25) * interval '1 hour' FROM generate_series(1, 50) g`, [conv, u.xa.id]);
      await c.query('ANALYZE social.messages');
      const plan = (await c.query(`EXPLAIN (FORMAT JSON) SELECT id FROM social.messages WHERE expires_at IS NOT NULL AND expires_at <= now() ORDER BY expires_at LIMIT 500`)).rows[0]['QUERY PLAN'];
      const text = JSON.stringify(plan);
      expect(text).toContain('messages_expires_idx');
      expect(text).not.toContain('"Seq Scan"');
      // O ficheiro de uma mensagem expirada deixa de se servir: essa verificação também não varre a tabela.
      const media = JSON.stringify((await c.query(`EXPLAIN (FORMAT JSON) SELECT 1 FROM social.messages m WHERE m.expires_at IS NOT NULL AND m.expires_at <= now() AND m.media_id = gen_random_uuid()`)).rows[0]['QUERY PLAN']);
      expect(media).not.toContain('"Seq Scan"');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('um presente expirado fica como linha vazia (com o gift_tx), não volta a ser apanhado e não mexe no dinheiro', async () => {
    const gift = await raw("now() - interval '1 minute'", { kind: 'gift', body: '5 Txills', gift: true });
    const tx = (await row(gift)).gift_tx as string;
    const money = async () => (await pool.query('SELECT (SELECT count(*) FROM ledger.transactions)::int AS t, (SELECT count(*) FROM ledger.entries)::int AS e')).rows[0];
    const before = await money();
    expect(await expiry.run()).toBe(1);
    const r = await row(gift);
    expect(r).toMatchObject({ gift_tx: tx, expires_at: null, body: '', kind: 'text' });
    expect(r.deleted_at).not.toBeNull();
    // Não aparece a ninguém (nem como "mensagem apagada").
    const items = (await api().get(`/api/v1/chat/with/${u.xa.username}?read=0`).set(auth(u.xb)).expect(200)).body.items as { id: string }[];
    expect(items.some((m) => m.id === gift)).toBe(false);
    // A volta seguinte já não lhe pega (senão ficava presa nas mesmas 500 para sempre).
    expect(await expiry.run()).toBe(0);
    expect(await money()).toEqual(before);
  });

  it('conta eliminada: as mensagens dela saem com a conta; as dos outros no grupo expiram e a limpeza não parte; a conversa a dois já não existe', async () => {
    const { xa, xb, xc } = u;
    const g = (await api().post('/api/v1/chat/groups').set(auth(xa)).send({ name: 'Expira eliminada', members: [xb.username, xc.username] }).expect(201)).body.id as string;
    await api().put(`/api/v1/chat/groups/${g}/ttl`).set(auth(xa)).send({ ttl: 86_400 }).expect(200);
    const fromC = (await api().post(`/api/v1/chat/groups/${g}/messages`).set(auth(xc)).send({ body: 'vou-me embora' }).expect(201)).body as { id: string; expiresAt: string | null };
    expect(fromC.expiresAt).not.toBeNull();
    await api().post(`/api/v1/chat/with/${xa.username}`).set(auth(xc)).send({ body: 'adeus' }).expect(201);
    await api().post('/api/v1/auth/delete-account').set(auth(xc)).send({ confirmUsername: xc.username, password: PASSWORD }).expect(204);
    // A conversa a dois foi com a conta; mudar as temporárias com ela é 404.
    await api().put(`/api/v1/chat/with/${xc.username}/ttl`).set(auth(xa)).send({ ttl: 86_400 }).expect(404);
    await api().post(`/api/v1/chat/with/${xc.username}/clear`).set(auth(xa)).expect(404);
    // Eliminar a conta já apaga as mensagens dela (também a temporária no grupo): a limpeza não tem nada dela para fazer.
    expect(await row(fromC.id)).toBeUndefined();
    // As de quem ficou continuam a expirar normalmente, com a conta eliminada ainda no histórico do grupo.
    const fromB = (await api().post(`/api/v1/chat/groups/${g}/messages`).set(auth(xb)).send({ body: 'fico eu' }).expect(201)).body.id as string;
    await pool.query("UPDATE social.messages SET expires_at = now() - interval '1 second' WHERE id = $1", [fromB]);
    expect(await expiry.run()).toBe(1);
    expect(await row(fromB)).toBeUndefined();
    const items = (await api().get(`/api/v1/chat/groups/${g}`).set(auth(xa)).expect(200)).body.items as { id: string; kind: string }[];
    expect(items.some((m) => m.id === fromB || m.id === fromC.id)).toBe(false);
    expect(items[0].kind).toBe('system');
  });

  it('a 0123 a correr duas vezes não parte: o migrate salta-a e o SQL repetido falha inteiro, sem mudar nada', async () => {
    await expect(migrate(DB)).resolves.toBeUndefined();
    await expect(migrate(DB)).resolves.toBeUndefined();
    expect((await pool.query('SELECT count(*)::int AS n FROM schema_migrations WHERE name = $1', [MIGRATION])).rows[0].n).toBe(1);

    const cols = async () => (await pool.query(
      `SELECT table_name || '.' || column_name AS c, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'social' AND ((table_name IN ('conversations', 'groups') AND column_name = 'ttl_seconds')
           OR (table_name = 'messages' AND column_name IN ('expires_at', 'system'))
           OR (table_name = 'conversations' AND column_name IN ('cleared_keep_a', 'cleared_keep_b'))
           OR (table_name = 'group_members' AND column_name = 'cleared_id')) ORDER BY 1`,
    )).rows;
    const before = await cols();
    // Valores por omissão: tudo desligado / vazio nas linhas que já existiam.
    expect(before).toEqual([
      { c: 'conversations.cleared_keep_a', is_nullable: 'NO', column_default: 'false' },
      { c: 'conversations.cleared_keep_b', is_nullable: 'NO', column_default: 'false' },
      { c: 'conversations.ttl_seconds', is_nullable: 'YES', column_default: null },
      { c: 'group_members.cleared_id', is_nullable: 'YES', column_default: null },
      { c: 'groups.ttl_seconds', is_nullable: 'YES', column_default: null },
      { c: 'messages.expires_at', is_nullable: 'YES', column_default: null },
      { c: 'messages.system', is_nullable: 'YES', column_default: null },
    ]);

    const sql = readFileSync(join(__dirname, '../../migrations', MIGRATION), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await expect(c.query(sql)).rejects.toThrow(/already exists/);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    expect(await cols()).toEqual(before);
    const kinds = (await pool.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'messages_kind_check' AND conrelid = 'social.messages'::regclass")).rows;
    expect(kinds).toHaveLength(1);
    for (const k of ['text', 'story_reply', 'story_reaction', 'image', 'voice', 'sticker', 'location', 'post', 'gift', 'video', 'zas_reply', 'call', 'poll', 'gif', 'system', 'gelada', 'rodada', 'mixar']) {
      expect(kinds[0].d).toContain(`'${k}'::text`);
    }
    // E as durações fora da lista não entram na base, mesmo sem passar pela API.
    await expect(pool.query('UPDATE social.conversations SET ttl_seconds = 3600 WHERE id = $1', [conv])).rejects.toThrow(/check constraint/);
  });
});
