import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from './main';
import { migrate } from './db/migrate';
import { loadConfig } from './config';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('MVP: carteira, ledger, feed, media (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now();
  const api = () => request(app.getHttpServer());
  let ana: { token: string; id: string; username: string };
  let bruno: { token: string; id: string; username: string };

  async function signup(name: string) {
    const username = `${name}${run}`.slice(0, 30);
    const r = await api()
      .post('/api/v1/auth/register')
      .send({ email: `${username}@example.com`, username, displayName: name, password: 'password-bem-longa-1' })
      .expect(201);
    return { token: r.body.accessToken as string, id: r.body.user.id as string, username };
  }
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'y'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }),
    );
    await app.init();
    ana = await signup('ana');
    bruno = await signup('bruno');
    // Só se presenteia quem se segue: o Bruno segue a Ana (a Ana só passa a seguir o Bruno nos testes que o precisam).
    await api().post(`/api/v1/users/${ana.username}/follow`).set(auth(bruno)).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('carteira abre com bónus de demonstração e rotula Txills como fictícios', async () => {
    const w = await api().get('/api/v1/wallet').set(auth(ana)).expect(200);
    expect(w.body).toMatchObject({ balance: 1000, currency: 'TXL', demo: true });
  });

  it('exige autenticação e Idempotency-Key', async () => {
    await api().get('/api/v1/wallet').expect(401);
    await api().post('/api/v1/wallet/transfers').set(auth(ana)).send({ toUsername: bruno.username, amount: 5 }).expect(400);
  });

  it('transferência é idempotente: repetir a chave não debita duas vezes', async () => {
    await api().get('/api/v1/wallet').set(auth(bruno)); // abre carteira do destinatário
    const send = () =>
      api().post('/api/v1/wallet/transfers').set(auth(ana)).set('Idempotency-Key', `idem-${run}-1`).send({ toUsername: bruno.username, amount: 100 });
    const a = await send().expect(201);
    const b = await send().expect(201);
    expect(b.body.transactionId).toBe(a.body.transactionId);
    expect(b.body.replayed).toBe(true);
    expect((await api().get('/api/v1/wallet').set(auth(ana))).body.balance).toBe(900);
  });

  it('gasto duplo concorrente: 20 pedidos de 100 com saldo de 900 → exactamente 9 sucessos, saldo 0', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        api()
          .post('/api/v1/wallet/transfers')
          .set(auth(ana))
          .set('Idempotency-Key', `race-${run}-${i}`)
          .send({ toUsername: bruno.username, amount: 100 }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;
    expect(ok).toBe(9);
    expect(rejected).toBe(11);
    expect((await api().get('/api/v1/wallet').set(auth(ana))).body.balance).toBe(0);
    expect((await api().get('/api/v1/wallet').set(auth(bruno))).body.balance).toBe(1000 + 100 + 900);
  });

  it('invariantes do ledger: cada transacção soma zero e saldo = soma dos lançamentos', async () => {
    const unbalanced = await pool.query(
      'SELECT transaction_id FROM ledger.entries GROUP BY transaction_id HAVING SUM(amount) <> 0',
    );
    expect(unbalanced.rowCount).toBe(0);
    const drift = await pool.query(
      `SELECT a.id FROM ledger.accounts a
         LEFT JOIN (SELECT account_id, SUM(amount) s FROM ledger.entries GROUP BY account_id) e ON e.account_id = a.id
        WHERE a.balance <> COALESCE(e.s, 0)`,
    );
    expect(drift.rowCount).toBe(0);
    await expect(pool.query('UPDATE ledger.entries SET amount = 1')).rejects.toThrow(/imutável/);
  });

  it('upload de imagem: valida bytes reais, publica no feed, brinda, comenta e presenteia', async () => {
    // Tipo declarado PNG mas conteúdo falso → rejeitado.
    const bad = await api().post('/api/v1/media/uploads').set(auth(bruno)).send({ mime: 'image/png', size: 40 }).expect(201);
    await api().put(bad.body.uploadUrl).set('Content-Type', 'image/png').send(Buffer.from('isto não é uma imagem!')).expect(415);

    // Assinatura adulterada → 403.
    const up = await api().post('/api/v1/media/uploads').set(auth(bruno)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl.replace(/sig=./, 'sig=X')).send(PNG).expect(403);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    await api().post('/api/v1/media/uploads').set(auth(bruno)).send({ mime: 'application/pdf', size: 10 }).expect(415);

    const post = await api()
      .post('/api/v1/posts')
      .set(auth(bruno))
      .send({ body: 'Sejam bem vindos à Praia da Barra', locationLabel: 'Bairro do Fomento', mediaIds: [up.body.assetId] })
      .expect(201);
    expect(post.body.media[0].url).toContain(up.body.assetId);
    await api().get(post.body.media[0].url).expect(200).expect('Content-Type', /image\/png/);

    // Não se pode usar media de outro utilizador.
    await api().post('/api/v1/posts').set(auth(ana)).send({ body: 'x', mediaIds: [up.body.assetId] }).expect(400);

    const c1 = await api().post(`/api/v1/posts/${post.body.id}/cheers`).set(auth(ana)).expect(200);
    expect(c1.body).toEqual({ cheered: true, cheers: 1 });
    const c2 = await api().post(`/api/v1/posts/${post.body.id}/cheers`).set(auth(ana)).expect(200);
    expect(c2.body).toEqual({ cheered: false, cheers: 0 });

    await api().post(`/api/v1/posts/${post.body.id}/comments`).set(auth(ana)).send({ body: 'Que lugar lindo!' }).expect(201);

    // Sem seguir o autor não se presenteia; depois de seguir, sim.
    await api().post(`/api/v1/posts/${post.body.id}/gifts`).set(auth(ana)).set('Idempotency-Key', `gift-${run}-nf`).send({ amount: 1 }).expect(403);
    await api().post(`/api/v1/users/${bruno.username}/follow`).set(auth(ana)).expect(200);

    // Ana está sem saldo → presente rejeitado; Bruno não pode presentear o próprio post.
    await api().post(`/api/v1/posts/${post.body.id}/gifts`).set(auth(ana)).set('Idempotency-Key', `gift-${run}-0`).send({ amount: 10 }).expect(422);
    await api().post(`/api/v1/posts/${post.body.id}/gifts`).set(auth(bruno)).set('Idempotency-Key', `gift-${run}-1`).send({ amount: 10 }).expect(422);
    // Bruno devolve 50 a Ana, que presenteia 20.
    await api().post('/api/v1/wallet/transfers').set(auth(bruno)).set('Idempotency-Key', `back-${run}`).send({ toUsername: ana.username, amount: 50 }).expect(201);
    const g = await api().post(`/api/v1/posts/${post.body.id}/gifts`).set(auth(ana)).set('Idempotency-Key', `gift-${run}-2`).send({ amount: 20 }).expect(201);
    expect(g.body.post.gifts).toBe(1);
    const g2 = await api().post(`/api/v1/posts/${post.body.id}/gifts`).set(auth(ana)).set('Idempotency-Key', `gift-${run}-2`).send({ amount: 20 }).expect(201);
    expect(g2.body.replayed).toBe(true);
    expect(g2.body.post.gifts).toBe(1);

    const feed = await api().get('/api/v1/posts?limit=5').set(auth(ana)).expect(200);
    expect(feed.body.items[0]).toMatchObject({ id: post.body.id, comments: 1, gifts: 1, cheers: 0, cheered: false });
  });

  async function uploadPng(u: { token: string }) {
    const r = await api().post('/api/v1/media/uploads').set(auth(u)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return r.body.assetId as string;
  }

  it('várias fotos por post, em ordem; sem reutilizar fotos nem posts vazios', async () => {
    const ids = [await uploadPng(bruno), await uploadPng(bruno), await uploadPng(bruno)];
    const post = await api().post('/api/v1/posts').set(auth(bruno)).send({ body: 'Fim de semana', mediaIds: ids }).expect(201);
    expect(post.body.media.map((m: { url: string }) => m.url.split('/').pop())).toEqual(ids);

    await api().post('/api/v1/posts').set(auth(bruno)).send({ body: 'de novo', mediaIds: [ids[0]] }).expect(400); // foto já usada
    await api().post('/api/v1/posts').set(auth(bruno)).send({ body: '' }).expect(400); // sem texto nem fotos
    const soloMedia = await uploadPng(bruno);
    const solo = await api().post('/api/v1/posts').set(auth(bruno)).send({ mediaIds: [soloMedia] }).expect(201); // só foto
    expect(solo.body.body).toBe('');
    const many = Array.from({ length: 11 }, () => '01a162cb-29ed-761e-a705-629e7320f35a');
    await api().post('/api/v1/posts').set(auth(bruno)).send({ body: 'x', mediaIds: many }).expect(400); // máximo 10
  });

  it('comentários: respostas no mesmo fio, brindes, paginação e permissões ao apagar', async () => {
    const P = (await api().post('/api/v1/posts').set(auth(ana)).send({ body: 'post da Ana' }).expect(201)).body;
    const post = (txt: string, parentId?: string, u = bruno) =>
      api().post(`/api/v1/posts/${P.id}/comments`).set(auth(u)).send({ body: txt, parentId });
    const C = (await post('comentário de topo').expect(201)).body;
    const R1 = (await post('resposta da Ana', C.id, ana).expect(201)).body;
    const R2 = (await post('resposta à resposta', R1.id).expect(201)).body;
    expect(R1.parentId).toBe(C.id);
    expect(R2.parentId).toBe(C.id); // resposta a resposta fica sob o comentário de topo

    const top = await api().get(`/api/v1/posts/${P.id}/comments`).set(auth(ana)).expect(200);
    expect(top.body.items).toHaveLength(1);
    expect(top.body.items[0]).toMatchObject({ id: C.id, replyCount: 2, cheers: 0, cheered: false });
    const replies = await api().get(`/api/v1/comments/${C.id}/replies`).set(auth(ana)).expect(200);
    expect(replies.body.items.map((x: { id: string }) => x.id)).toEqual([R1.id, R2.id]);

    // Resposta a um comentário de outro post é rejeitada.
    const other = (await api().post('/api/v1/posts').set(auth(ana)).send({ body: 'outro' }).expect(201)).body;
    await api().post(`/api/v1/posts/${other.id}/comments`).set(auth(ana)).send({ body: 'x', parentId: C.id }).expect(400);

    expect((await api().post(`/api/v1/comments/${C.id}/cheers`).set(auth(ana)).expect(200)).body).toEqual({ cheered: true, cheers: 1 });
    expect((await api().post(`/api/v1/comments/${C.id}/cheers`).set(auth(ana)).expect(200)).body).toEqual({ cheered: false, cheers: 0 });

    for (let i = 0; i < 4; i++) await post(`extra ${i}`).expect(201);
    const p1 = await api().get(`/api/v1/posts/${P.id}/comments?limit=3`).set(auth(ana)).expect(200);
    const p2 = await api().get(`/api/v1/posts/${P.id}/comments?limit=3&cursor=${p1.body.nextCursor}`).set(auth(ana)).expect(200);
    const ids = [...p1.body.items, ...p2.body.items].map((x: { id: string }) => x.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);

    // Apagar: o Bruno não apaga a resposta da Ana; a dona do post (Ana) apaga o comentário de topo e as respostas saem juntas.
    await api().delete(`/api/v1/comments/${R1.id}`).set(auth(bruno)).expect(404);
    await api().delete(`/api/v1/comments/${C.id}`).set(auth(ana)).expect(200);
    await api().get(`/api/v1/comments/${C.id}/replies`).set(auth(ana)).expect(404); // o comentário (e as respostas) já não existem
    const feed = await api().get('/api/v1/posts?limit=20').set(auth(ana)).expect(200);
    expect(feed.body.items.find((x: { id: string }) => x.id === P.id).comments).toBe(4);
  });

  it('presentear alguém directamente, com ou sem post "X presenteou Y"; idempotente', async () => {
    const give = (key: string, b: object, u = bruno) => api().post('/api/v1/gifts').set(auth(u)).set('Idempotency-Key', key).send(b);

    // Regra: só se presenteia quem se segue (numa publicação ou directamente), e a publicação avisa o ecrã.
    const rule = (await api().post('/api/v1/posts').set(auth(ana)).send({ body: 'regra dos presentes' }).expect(201)).body;
    await api().delete(`/api/v1/users/${ana.username}/follow`).set(auth(bruno)).expect(200);
    await give(`dg-${run}-0`, { toUsername: ana.username, amount: 1 }).expect(403);
    await api().post(`/api/v1/posts/${rule.id}/gifts`).set(auth(bruno)).set('Idempotency-Key', `dg-${run}-0b`).send({ amount: 1 }).expect(403);
    const seenBefore = (await api().get('/api/v1/posts?limit=50').set(auth(bruno)).expect(200)).body.items.find((x: { id: string }) => x.id === rule.id);
    expect(seenBefore).toMatchObject({ canGift: false, authorFollowed: false });
    await api().post(`/api/v1/users/${ana.username}/follow`).set(auth(bruno)).expect(200);
    const seenAfter = (await api().get('/api/v1/posts?limit=50').set(auth(bruno)).expect(200)).body.items.find((x: { id: string }) => x.id === rule.id);
    expect(seenAfter).toMatchObject({ canGift: true, authorFollowed: true });

    // Público: post "X presenteou Y" no feed.
    const a = await give(`dg-${run}-1`, { toUsername: `@${ana.username}`, amount: 10, note: 'Pela cerveja 🍻', visibility: 'public' }).expect(201);
    expect(a.body.post.gift).toEqual({ amount: 10, recipient: { username: ana.username, displayName: 'ana' } });
    expect(a.body.post.body).toBe('Pela cerveja 🍻');

    const again = await give(`dg-${run}-1`, { toUsername: ana.username, amount: 10, note: 'Pela cerveja 🍻', visibility: 'public' }).expect(201);
    expect(again.body.replayed).toBe(true);
    expect(again.body.post.id).toBe(a.body.post.id); // nada duplicado

    // Discreto: só o presente. Sem post e sem mensagem, mesmo que se envie texto.
    const quiet = await give(`dg-${run}-2`, { toUsername: ana.username, amount: 5, note: 'isto não deve ficar' }).expect(201);
    expect(quiet.body.post).toBeNull();
    const meta = await pool.query('SELECT metadata FROM ledger.transactions WHERE id = $1', [quiet.body.transactionId]);
    expect(meta.rows[0].metadata.note).toBeUndefined();

    // Privado: a mensagem fica só no movimento (o destinatário vê-a na carteira), sem post.
    const priv = await give(`dg-${run}-6`, { toUsername: ana.username, amount: 3, note: 'só para ti 🤫', visibility: 'private' }).expect(201);
    expect(priv.body.post).toBeNull();
    const wallet = (await api().get('/api/v1/wallet').set(auth(ana)).expect(200)).body;
    expect(wallet.history.some((h: { note: string | null }) => h.note === 'só para ti 🤫')).toBe(true);

    // Publicar DEPOIS: só o remetente, uma única vez, em qualquer presente já enviado.
    await api().post(`/api/v1/gifts/${priv.body.transactionId}/publish`).set(auth(ana)).send({}).expect(404); // não é o remetente
    const later = await api().post(`/api/v1/gifts/${priv.body.transactionId}/publish`).set(auth(bruno)).send({}).expect(201);
    expect(later.body.post.gift).toMatchObject({ amount: 3 });
    expect(later.body.post.body).toBe('só para ti 🤫');
    await api().post(`/api/v1/gifts/${priv.body.transactionId}/publish`).set(auth(bruno)).send({}).expect(409);
    await api().post(`/api/v1/gifts/${a.body.transactionId}/publish`).set(auth(bruno)).send({}).expect(409); // já era público
    await api().post(`/api/v1/gifts/${quiet.body.transactionId}/publish`).set(auth(bruno)).send({ note: 'afinal sim!' }).expect(201);

    await give(`dg-${run}-3`, { toUsername: bruno.username, amount: 5 }).expect(422); // a si próprio
    await give(`dg-${run}-4`, { toUsername: 'ninguem_assim', amount: 5 }).expect(404);
    await give(`dg-${run}-5`, { toUsername: ana.username, amount: 1_000_000 }).expect(422);
    await api().post('/api/v1/gifts').set(auth(bruno)).send({ toUsername: ana.username, amount: 5 }).expect(400); // sem Idempotency-Key

    const feed = await api().get('/api/v1/posts?limit=50').set(auth(ana)).expect(200);
    expect(feed.body.items.filter((x: { gift: unknown }) => x.gift).length).toBeGreaterThanOrEqual(1);
    const drift = await pool.query(
      `SELECT a.id FROM ledger.accounts a LEFT JOIN (SELECT account_id, SUM(amount) s FROM ledger.entries GROUP BY account_id) e
         ON e.account_id = a.id WHERE a.balance <> COALESCE(e.s, 0)`,
    );
    expect(drift.rowCount).toBe(0);
  });

  it('stories: bandeja, visualizações só para o autor, expiração e apagar', async () => {
    const mediaId = await uploadPng(bruno);
    const s = (await api().post('/api/v1/stories').set(auth(bruno)).send({ mediaId, caption: 'Praia 🌊' }).expect(201)).body;
    await api().post('/api/v1/stories').set(auth(bruno)).send({ mediaId }).expect(400); // foto já usada

    // A bandeja só mostra quem se segue: sem seguir, o Bruno não aparece.
    await api().delete(`/api/v1/users/${bruno.username}/follow`).set(auth(ana)).expect(200);
    let tray = (await api().get('/api/v1/stories').set(auth(ana)).expect(200)).body;
    expect(tray.find((t: { username: string }) => t.username === bruno.username)).toBeUndefined();
    await api().post(`/api/v1/users/${bruno.username}/follow`).set(auth(ana)).expect(200);
    tray = (await api().get('/api/v1/stories').set(auth(ana)).expect(200)).body;
    expect(tray.find((t: { username: string }) => t.username === bruno.username)).toMatchObject({ seen: false, count: 1, seenCount: 0, isMe: false });

    const list = (await api().get(`/api/v1/stories/user/${bruno.username}`).set(auth(ana)).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: s.id, caption: 'Praia 🌊', viewCount: null });
    await api().get(list[0].mediaUrl).expect(200);

    await api().post(`/api/v1/stories/${s.id}/view`).set(auth(ana)).expect(204);
    await api().post(`/api/v1/stories/${s.id}/view`).set(auth(ana)).expect(204); // idempotente
    await api().post(`/api/v1/stories/${s.id}/view`).set(auth(bruno)).expect(204); // o autor não conta
    tray = (await api().get('/api/v1/stories').set(auth(ana)).expect(200)).body;
    expect(tray.find((t: { username: string }) => t.username === bruno.username)).toMatchObject({ seen: true, seenCount: 1 });

    const own = (await api().get(`/api/v1/stories/user/${bruno.username}`).set(auth(bruno)).expect(200)).body;
    expect(own[0].viewCount).toBe(1);
    const viewers = (await api().get(`/api/v1/stories/${s.id}/viewers`).set(auth(bruno)).expect(200)).body;
    expect(viewers.map((v: { username: string }) => v.username)).toEqual([ana.username]);
    await api().get(`/api/v1/stories/${s.id}/viewers`).set(auth(ana)).expect(404); // só o autor vê

    // Responder / reagir: chega ao autor; só ele vê; não se responde ao próprio story.
    const text = (await api().post(`/api/v1/stories/${s.id}/replies`).set(auth(ana)).send({ body: 'Que vista! 😍 Onde é?' }).expect(201)).body;
    const emoji = (await api().post(`/api/v1/stories/${s.id}/replies`).set(auth(ana)).send({ body: '🔥' }).expect(201)).body;
    expect([text.kind, emoji.kind]).toEqual(['reply', 'reaction']);
    await api().post(`/api/v1/stories/${s.id}/replies`).set(auth(ana)).send({ body: '  ' }).expect(400);
    await api().post(`/api/v1/stories/${s.id}/replies`).set(auth(bruno)).send({ body: 'eu mesmo' }).expect(400);
    const inbox = (await api().get(`/api/v1/stories/${s.id}/replies`).set(auth(bruno)).expect(200)).body;
    expect(inbox.map((r: { body: string }) => r.body)).toEqual(['🔥', 'Que vista! 😍 Onde é?']);
    expect(inbox[0].author.username).toBe(ana.username);
    await api().get(`/api/v1/stories/${s.id}/replies`).set(auth(ana)).expect(404);

    // Dura 24 h.
    const life = await pool.query('SELECT extract(epoch FROM (expires_at - created_at)) AS secs FROM content.stories WHERE id = $1', [s.id]);
    expect(Math.round(Number(life.rows[0].secs))).toBe(24 * 3600);

    await api().delete(`/api/v1/stories/${s.id}`).set(auth(ana)).expect(404);
    await pool.query(`UPDATE content.stories SET expires_at = now() - interval '1 minute' WHERE id = $1`, [s.id]);
    tray = (await api().get('/api/v1/stories').set(auth(ana)).expect(200)).body;
    expect(tray.find((t: { username: string }) => t.username === bruno.username)).toBeUndefined();
    await api().post(`/api/v1/stories/${s.id}/view`).set(auth(ana)).expect(404);
    await api().post(`/api/v1/stories/${s.id}/replies`).set(auth(ana)).send({ body: 'tarde demais' }).expect(404); // expirado
    await api().delete(`/api/v1/stories/${s.id}`).set(auth(bruno)).expect(204);
  });

  it('places/nearby exige login e valida coordenadas', async () => {
    await api().get('/api/v1/places/nearby?lat=1&lng=1').expect(401);
    await api().get('/api/v1/places/nearby?lat=999&lng=1').set(auth(ana)).expect(400);
    await api().get('/api/v1/places/nearby?lat=abc&lng=1').set(auth(ana)).expect(400);
  });

  it('feed pagina por cursor sem repetir itens', async () => {
    for (let i = 0; i < 5; i++) {
      await api().post('/api/v1/posts').set(auth(ana)).send({ body: `post ${i}` }).expect(201);
    }
    const p1 = await api().get('/api/v1/posts?limit=3').set(auth(ana)).expect(200);
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await api().get(`/api/v1/posts?limit=3&cursor=${p1.body.nextCursor}`).set(auth(ana)).expect(200);
    const ids = [...p1.body.items, ...p2.body.items].map((x: { id: string }) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    await api().get('/api/v1/posts?cursor=nao-e-uuid').set(auth(ana)).expect(400);
  });
});
