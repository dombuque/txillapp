import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { InstantsRecapService, recapWeek } from './instants-recap.service';
import { RECAP_HEAD, RECAP_OUT, recapLayout, recapRange } from './zas-recap-card';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
/** A cor das fotos de teste (verde): aparece no meio de cada cartão da grelha. */
const GREEN = { r: 40, g: 180, b: 90 };

interface U { token: string; id: string; username: string }

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
};

async function pixel(img: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const px = await sharp(img).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  return [px[0], px[1], px[2]];
}
async function brightest(img: Buffer, left: number, top: number, width: number, height: number): Promise<number> {
  const px = await sharp(img).extract({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) }).removeAlpha().raw().toBuffer();
  let max = 0;
  for (const v of px) if (v > max) max = v;
  return max;
}

/** O último domingo às 21h de Maputo (19h UTC) antes de agora: a janela dos resumos dessa semana está aberta. */
function lastSundayNight(): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 19, 0, 0));
  while (d.getUTCDay() !== 0 || d > now) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

describe('resumo semanal dos Zás: guardar 7 dias, a definição, o resumo, o aviso e publicar nos mimos (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let jpeg: Buffer;
  let recaps: InstantsRecapService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function makeZas(a: U, caption = '') {
    const up = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/jpeg', size: jpeg.length, purpose: 'chat' }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    await api().post(`/api/v1/media/${up.body.assetId}/complete`).set(auth(a)).send({}).expect(200);
    return (await api().post('/api/v1/instants').set(auth(a)).send({ mediaId: up.body.assetId, caption }).expect(201)).body.id as string;
  }
  /** Põe o Zás no passado: tirado há `hours` horas (as 24 h e os 7 dias contam a partir daí). */
  const age = (id: string, hours: number) =>
    pool.query(
      `UPDATE social.instants SET created_at = now() - make_interval(hours => $2), expires_at = now() - make_interval(hours => $2) + interval '24 hours',
              keep_until = CASE WHEN keep_until IS NULL THEN NULL ELSE now() - make_interval(hours => $2) + interval '7 days' END WHERE id = $1`,
      [id, hours],
    );
  const mediaOf = async (id: string) => (await pool.query('SELECT media_id FROM social.instants WHERE id = $1', [id])).rows[0]?.media_id as string | undefined;
  const mediaStatus = async (mid: string) => (await pool.query('SELECT status FROM content.media_assets WHERE id = $1', [mid])).rows[0]?.status as string;
  const download = (x: U, path: string) => api().get(`/api/v1${path}`).set(auth(x)).buffer(true).parse(binary as never);

  /** Zás tirados dentro da semana do resumo (a janela que acaba no domingo às 20h), ainda guardados. */
  async function weekZas(a: U, n: number) {
    const week = recapWeek(lastSundayNight())!;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = await makeZas(a, `dia ${i}`);
      const at = new Date(week.end.getTime() - (i + 1) * 9 * 3_600_000);
      await pool.query(`UPDATE social.instants SET created_at = $2, expires_at = $2::timestamptz + interval '24 hours', keep_until = now() + interval '1 day' WHERE id = $1`, [id, at]);
      ids.push(id);
    }
    return { ids, week };
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'r'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    recaps = app.get(InstantsRecapService);
    jpeg = await sharp({ create: { width: 600, height: 800, channels: 3, background: GREEN } }).jpeg({ quality: 92 }).toBuffer();
    for (const n of ['zra', 'zrb', 'zrc', 'zrd', 'zre', 'zrf']) u[n] = await signup(n);
    // zra e zrb seguem-se (amigos: veem os Zás um do outro). zrc tem amigos: zrb (segue-se) e zre (amiga próxima).
    const mutual = async (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [a.id, b.id]);
    await mutual(u.zra, u.zrb);
    await mutual(u.zrc, u.zrb);
    await mutual(u.zrc, u.zre);
    await pool.query('INSERT INTO social.close_friends (owner_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.zrc.id, u.zre.id]);
    await pool.query("UPDATE identity.users SET verified = true, verified_tier = 'verified' WHERE id = $1", [u.zrc.id]);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('a semana do resumo: domingo 20h → segunda 6h de Maputo; «8 a 15 nov»', () => {
    // 15 nov 2026 é domingo. 21h de Maputo = 19h UTC.
    const w = recapWeek(new Date('2026-11-15T19:00:00Z'))!;
    expect([w.from, w.to]).toEqual(['2026-11-08', '2026-11-15']);
    expect(w.end.toISOString()).toBe('2026-11-15T18:00:00.000Z');
    expect(recapWeek(new Date('2026-11-16T03:00:00Z'))?.to).toBe('2026-11-15');
    expect(recapWeek(new Date('2026-11-15T17:00:00Z'))).toBeNull();
    expect(recapWeek(new Date('2026-11-14T19:00:00Z'))).toBeNull();
    expect(recapRange('2026-11-08', '2026-11-15')).toBe('8 a 15 nov');
    expect(recapRange('2026-11-29', '2026-12-06')).toBe('29 nov a 6 dez');
  });

  it('retenção: os outros deixam de ver às 24 h; eu vejo até aos 7 dias (arquivo e guardar); aos 7 dias apaga-se (linha e ficheiro)', async () => {
    expect((await api().get('/api/v1/instants/settings').set(auth(u.zra)).expect(200)).body).toEqual({ keepForRecap: true });
    const id = await makeZas(u.zra, 'praia');
    expect((await pool.query('SELECT keep_until IS NOT NULL AS k FROM social.instants WHERE id = $1', [id])).rows[0].k).toBe(true);
    // Nas 24 h: a zrb vê-o.
    expect((await api().get('/api/v1/instants/feed').set(auth(u.zrb)).expect(200)).body.map((x: { id: string }) => x.id)).toContain(id);
    await age(id, 30);
    // Passadas as 24 h: a zrb já não o vê em lado nenhum (nem o pode guardar).
    expect((await api().get('/api/v1/instants/feed').set(auth(u.zrb)).expect(200)).body.map((x: { id: string }) => x.id)).not.toContain(id);
    expect((await api().get(`/api/v1/instants/of/${u.zra.username}`).set(auth(u.zrb)).expect(200)).body).toEqual([]);
    expect((await api().get('/api/v1/instants').set(auth(u.zrb)).expect(200)).body.others.map((o: { username: string }) => o.username)).not.toContain(u.zra.username);
    await download(u.zrb, `/instants/${id}/download`).expect(404);
    // Eu vejo-o no arquivo (guardado, só para mim) e posso guardá-lo; na faixa já não conta como ativo.
    const arch = (await api().get('/api/v1/instants/archive').set(auth(u.zra)).expect(200)).body as { id: string; active: boolean; keepUntil: string }[];
    const mine = arch.find((x) => x.id === id)!;
    expect(mine.active).toBe(false);
    expect(new Date(mine.keepUntil).getTime()).toBeGreaterThan(Date.now() + 5 * 86_400_000);
    expect((await api().get('/api/v1/instants').set(auth(u.zra)).expect(200)).body.mine.count).toBe(0);
    const f = await download(u.zra, `/instants/${id}/download`).expect(200);
    expect(f.headers['content-type']).toMatch(/^image\/jpeg/);
    // A limpeza ainda não lhe toca.
    await recaps.sweep();
    expect(await mediaOf(id)).toBeDefined();
    // Aos 7 dias: sai a linha e o ficheiro passa a apagado.
    const mid = (await mediaOf(id))!;
    await age(id, 7 * 24 + 1);
    expect((await api().get('/api/v1/instants/archive').set(auth(u.zra)).expect(200)).body.map((x: { id: string }) => x.id)).not.toContain(id);
    await download(u.zra, `/instants/${id}/download`).expect(404);
    const swept = await recaps.sweep();
    expect(swept.instants).toBeGreaterThanOrEqual(1);
    expect(await mediaOf(id)).toBeUndefined();
    expect(await mediaStatus(mid)).toBe('deleted');
  });

  it('um Zás com denúncia por decidir fica até à decisão', async () => {
    const id = await makeZas(u.zra);
    await pool.query("INSERT INTO social.reports (id, reporter_id, target_type, target_id, reason, status) VALUES (gen_random_uuid(), $1, 'instant', $2, 'spam', 'open')", [u.zrb.id, id]);
    await age(id, 8 * 24);
    await recaps.sweep();
    expect(await mediaOf(id)).toBeDefined();
    await pool.query("UPDATE social.reports SET status = 'dismissed' WHERE target_id = $1", [id]);
    await recaps.sweep();
    expect(await mediaOf(id)).toBeUndefined();
  });

  it('definição desligada: os guardados apagam-se logo, os novos só duram 24 h; ligada outra vez, voltam a guardar-se', async () => {
    const old = await makeZas(u.zrd, 'velho');
    const fresh = await makeZas(u.zrd, 'novo');
    await age(old, 30);
    const oldMedia = (await mediaOf(old))!;
    const off = (await api().put('/api/v1/instants/settings').set(auth(u.zrd)).send({ keepForRecap: false }).expect(200)).body;
    expect(off).toEqual({ keepForRecap: false, removed: 1 });
    expect(await mediaOf(old)).toBeUndefined();
    expect(await mediaStatus(oldMedia)).toBe('deleted');
    // O que está nas 24 h continua (para os outros também), mas já não fica guardado.
    expect((await pool.query('SELECT keep_until FROM social.instants WHERE id = $1', [fresh])).rows[0].keep_until).toBeNull();
    const nu = await makeZas(u.zrd, 'sem guardar');
    expect((await pool.query('SELECT keep_until FROM social.instants WHERE id = $1', [nu])).rows[0].keep_until).toBeNull();
    expect((await api().get('/api/v1/instants/settings').set(auth(u.zrd)).expect(200)).body).toEqual({ keepForRecap: false });
    // Às 24 h desaparece também para mim e a limpeza apaga-o.
    await age(nu, 25);
    expect((await api().get('/api/v1/instants/archive').set(auth(u.zrd)).expect(200)).body.map((x: { id: string }) => x.id)).not.toContain(nu);
    await recaps.sweep();
    expect(await mediaOf(nu)).toBeUndefined();
    // Sem a definição não há resumo, mesmo com Zás que chegassem.
    await weekZas(u.zrd, 3);
    await pool.query('UPDATE social.instants SET keep_until = NULL WHERE author_id = $1', [u.zrd.id]);
    expect((await recaps.run({ now: lastSundayNight(), onlyUsers: [u.zrd.id] })).made).toBe(0);
    // Ligar outra vez: os ativos voltam a ficar 7 dias.
    const on = (await api().put('/api/v1/instants/settings').set(auth(u.zrd)).send({ keepForRecap: true }).expect(200)).body;
    expect(on).toEqual({ keepForRecap: true, removed: 0 });
    expect((await pool.query('SELECT keep_until IS NOT NULL AS k FROM social.instants WHERE id = $1', [fresh])).rows[0].k).toBe(true);
    await api().put('/api/v1/instants/settings').set(auth(u.zrd)).send({ keepForRecap: 'sim' }).expect(400);
  });

  let recapId = '';
  it('o resumo: só com 3 Zás ou mais, uma vez por semana, a imagem 1080×1920 com o título, as datas, a grelha e a assinatura', async () => {
    const now = lastSundayNight();
    const { week } = await weekZas(u.zrc, 5);
    await weekZas(u.zrf, 2);
    // Fora da janela (sábado), nada.
    expect(await recaps.run({ now: new Date(now.getTime() - 86_400_000), onlyUsers: [u.zrc.id] })).toEqual({ made: 0, outside: true });
    expect((await recaps.run({ now, onlyUsers: [u.zrc.id, u.zrf.id] })).made).toBe(1);
    // A segunda volta não repete.
    expect((await recaps.run({ now, onlyUsers: [u.zrc.id, u.zrf.id] })).made).toBe(0);
    expect((await api().get('/api/v1/instants/recaps').set(auth(u.zrf)).expect(200)).body).toEqual([]);
    const list = (await api().get('/api/v1/instants/recaps').set(auth(u.zrc)).expect(200)).body;
    expect(list).toHaveLength(1);
    const r = list[0];
    recapId = r.id;
    expect(r).toMatchObject({ weekStart: week.from, weekEnd: week.to, label: recapRange(week.from, week.to), count: 5, photos: 5, published: null });
    expect(r.url).toMatch(/^\/api\/v1\/chat\/media\//);
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect((await api().get(`/api/v1/instants/recaps/${r.id}`).set(auth(u.zrc)).expect(200)).body.id).toBe(r.id);

    const f = await download(u.zrc, `/instants/recaps/${r.id}/download`).expect(200);
    expect(f.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(f.headers['content-disposition']).toBe(`attachment; filename="txillapp-resumo-zas-${week.to}.jpg"`);
    const img = f.body as Buffer;
    const meta = await sharp(img).metadata();
    expect([meta.width, meta.height]).toEqual([RECAP_OUT.W, RECAP_OUT.H]);
    // O fundo escuro no canto de cima.
    expect(Math.max(...(await pixel(img, 20, 20)))).toBeLessThan(25);
    // O título branco ao meio, em cima, e as datas por baixo (coral claro).
    expect(await brightest(img, 200, RECAP_HEAD.titleY - RECAP_HEAD.titleSize * 0.7, 680, RECAP_HEAD.titleSize * 0.7)).toBeGreaterThan(220);
    const dates = await sharp(img).extract({ left: 340, top: RECAP_HEAD.datesY - RECAP_HEAD.datesSize, width: 400, height: RECAP_HEAD.datesSize + 6 }).removeAlpha().raw().toBuffer();
    let coral = false;
    for (let i = 0; i < dates.length; i += 3) if (dates[i] > 200 && dates[i + 1] > 100 && dates[i + 1] < 170 && dates[i + 2] < 170) coral = true;
    expect(coral).toBe(true);
    // A grelha: o meio de cada cartão é a foto (verde); entre cartões, o fundo escuro.
    const cells = recapLayout(5);
    for (const c of cells) {
      const [pr, pg, pb] = await pixel(img, c.x + c.w / 2, c.y + c.h / 2);
      expect(Math.abs(pr - GREEN.r)).toBeLessThan(18);
      expect(Math.abs(pg - GREEN.g)).toBeLessThan(18);
      expect(Math.abs(pb - GREEN.b)).toBeLessThan(18);
    }
    const gapX = cells[0].x + cells[0].w + 13, gapY = cells[0].y + cells[0].h / 2;
    expect(Math.max(...(await pixel(img, gapX, gapY)))).toBeLessThan(60);
    // A assinatura (branca) no canto de baixo, à direita, abaixo da grelha.
    expect(await brightest(img, 780, RECAP_OUT.H - 170, 290, 160)).toBeGreaterThan(200);
    // A imagem é privada: guarda-se como ficheiro do chat, assinado.
    const m = (await pool.query('SELECT a.purpose, a.signed FROM social.zas_recaps z JOIN content.media_assets a ON a.id = z.media_id WHERE z.id = $1', [r.id])).rows[0];
    expect(m).toEqual({ purpose: 'chat', signed: true });
  });

  it('só o próprio vê o resumo', async () => {
    await api().get(`/api/v1/instants/recaps/${recapId}`).set(auth(u.zrb)).expect(404);
    await download(u.zrb, `/instants/recaps/${recapId}/download`).expect(404);
    await api().post(`/api/v1/instants/recaps/${recapId}/publish`).set(auth(u.zrb)).send({ audience: 'all' }).expect(404);
    await api().delete(`/api/v1/instants/recaps/${recapId}`).set(auth(u.zrb)).expect(404);
  });

  it('o aviso: na lista em nome do Txillapp, com a miniatura do resumo; com «Resumo dos Zás» desligado, nada', async () => {
    const n = (await api().get('/api/v1/notifications').set(auth(u.zrc)).expect(200)).body.items.find((x: { kind: string }) => x.kind === 'zas_recap');
    expect(n).toBeDefined();
    expect(n.data).toMatchObject({ recapId, count: 5 });
    expect(n.actor).toMatchObject({ username: 'txillapp', staff: true });
    expect(n.thumb.url).toMatch(/^\/api\/v1\/chat\/media\//);
    expect((await api().get('/api/v1/notifications/settings').set(auth(u.zrc)).expect(200)).body.categories).toContain('zas');
    // Quem desligou a categoria tem o resumo, mas não o aviso.
    await api().put('/api/v1/notifications/settings').set(auth(u.zrf)).send({ off: ['zas'] }).expect((x) => expect([200, 204]).toContain(x.status));
    await weekZas(u.zrf, 1);
    expect((await recaps.run({ now: lastSundayNight(), onlyUsers: [u.zrf.id] })).made).toBe(1);
    expect((await api().get('/api/v1/instants/recaps').set(auth(u.zrf)).expect(200)).body).toHaveLength(1);
    expect((await api().get('/api/v1/notifications').set(auth(u.zrf)).expect(200)).body.items.filter((x: { kind: string }) => x.kind === 'zas_recap')).toEqual([]);
  });

  it('publicar nos mimos: vira um mimo-imagem só para os amigos próximos (quem não está na lista não o vê); outra vez dá 409', async () => {
    const r = await api().post(`/api/v1/instants/recaps/${recapId}/publish`).set(auth(u.zrc)).send({ audience: 'close_friends' }).expect(201);
    const storyId = r.body.storyId as string;
    expect(r.body.recap.published).toMatchObject({ storyId, audience: 'close_friends' });
    const s = (await pool.query('SELECT s.audience, a.purpose, a.signed, a.status, a.mime FROM content.stories s JOIN content.media_assets a ON a.id = s.media_id WHERE s.id = $1', [storyId])).rows[0];
    expect(s).toEqual({ audience: 'close_friends', purpose: 'public', signed: true, status: 'ready', mime: 'image/jpeg' });
    // A amiga próxima vê o mimo; o amigo (que se segue) não.
    const close = (await api().get(`/api/v1/stories/user/${u.zrc.username}`).set(auth(u.zre)).expect(200)).body;
    expect(JSON.stringify(close)).toContain(storyId);
    const friend = await api().get(`/api/v1/stories/user/${u.zrc.username}`).set(auth(u.zrb));
    expect(JSON.stringify(friend.body)).not.toContain(storyId);
    // A imagem do mimo é a do resumo, servida pelo endereço público.
    const pub = await api().get(`/api/v1/media/${(await pool.query('SELECT media_id FROM content.stories WHERE id = $1', [storyId])).rows[0].media_id}`).buffer(true).parse(binary as never).expect(200);
    expect((await sharp(pub.body as Buffer).metadata()).height).toBe(RECAP_OUT.H);
    await api().post(`/api/v1/instants/recaps/${recapId}/publish`).set(auth(u.zrc)).send({ audience: 'all' }).expect(409);
    // Apagado o mimo, o resumo volta a poder publicar-se (agora para os amigos todos: o amigo já o vê).
    await api().delete(`/api/v1/stories/${storyId}`).set(auth(u.zrc)).expect((x) => expect([200, 204]).toContain(x.status));
    expect((await api().get(`/api/v1/instants/recaps/${recapId}`).set(auth(u.zrc)).expect(200)).body.published).toBeNull();
    const again = (await api().post(`/api/v1/instants/recaps/${recapId}/publish`).set(auth(u.zrc)).send({ audience: 'all' }).expect(201)).body.storyId as string;
    expect(JSON.stringify((await api().get(`/api/v1/stories/user/${u.zrc.username}`).set(auth(u.zrb)).expect(200)).body)).toContain(again);
  });

  it('a exportação leva os Zás guardados, os resumos e a definição', async () => {
    const x = (await api().get('/api/v1/me/export').set(auth(u.zrc)).expect(200)).body;
    expect(x.settings.zasKeepForRecap).toBe(true);
    expect(x.zas.length).toBeGreaterThanOrEqual(5);
    expect(x.zas[0]).toEqual(expect.objectContaining({ keptForMeUntil: expect.any(String), visibleToOthersUntil: expect.any(String), photo: expect.stringMatching(/^\/api\/v1\/chat\/media\//) }));
    expect(x.zasRecaps).toHaveLength(1);
    expect(x.zasRecaps[0]).toEqual(expect.objectContaining({ id: recapId, zasCount: 5, publishedAudience: 'all', image: expect.stringMatching(/^\/api\/v1\/chat\/media\//) }));
  });

  it('o resumo por publicar apaga-se aos 7 dias (ficheiro e aviso); descartar também', async () => {
    const [mine] = (await api().get('/api/v1/instants/recaps').set(auth(u.zrf)).expect(200)).body;
    const mid = (await pool.query('SELECT media_id FROM social.zas_recaps WHERE id = $1', [mine.id])).rows[0].media_id as string;
    await pool.query("UPDATE social.zas_recaps SET expires_at = now() - interval '1 minute' WHERE id = $1", [mine.id]);
    expect((await api().get('/api/v1/instants/recaps').set(auth(u.zrf)).expect(200)).body).toEqual([]);
    await api().get(`/api/v1/instants/recaps/${mine.id}`).set(auth(u.zrf)).expect(404);
    expect((await recaps.sweep()).recaps).toBeGreaterThanOrEqual(1);
    expect((await pool.query('SELECT 1 FROM social.zas_recaps WHERE id = $1', [mine.id])).rowCount).toBe(0);
    expect(await mediaStatus(mid)).toBe('deleted');
  });

  it('desligar a definição apaga também os resumos; apagar a conta apaga os Zás e os resumos', async () => {
    const { week } = await weekZas(u.zra, 3);
    expect((await recaps.run({ now: lastSundayNight(), onlyUsers: [u.zra.id] })).made).toBe(1);
    const [r] = (await api().get('/api/v1/instants/recaps').set(auth(u.zra)).expect(200)).body;
    expect(r.weekEnd).toBe(week.to);
    await api().put('/api/v1/instants/settings').set(auth(u.zra)).send({ keepForRecap: false }).expect(200);
    expect((await api().get('/api/v1/instants/recaps').set(auth(u.zra)).expect(200)).body).toEqual([]);
    expect((await pool.query("SELECT 1 FROM social.notifications WHERE user_id = $1 AND kind = 'zas_recap'", [u.zra.id])).rowCount).toBe(0);

    const before = (await pool.query('SELECT count(*)::int AS n FROM social.zas_recaps WHERE user_id = $1', [u.zrc.id])).rows[0].n as number;
    expect(before).toBe(1);
    await api().post('/api/v1/auth/delete-account').set(auth(u.zrc)).send({ confirmUsername: u.zrc.username, password: PASSWORD }).expect(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.zas_recaps WHERE user_id = $1', [u.zrc.id])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.instants WHERE author_id = $1', [u.zrc.id])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM content.media_assets WHERE owner_id = $1 AND status <> 'deleted'", [u.zrc.id])).rows[0].n).toBe(0);
  });
});
