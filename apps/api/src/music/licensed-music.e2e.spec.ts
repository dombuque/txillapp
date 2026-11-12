import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { LicensedMusicService } from './licensed-music.service';
import { FakeLicensedProvider } from './providers/fake-licensed.provider';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const BASE = { DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' } as NodeJS.ProcessEnv;

interface U { token: string; id: string; username: string }

describe('música licenciada: fornecedor simulado, territórios, uso agregado e remoções (integração)', () => {
  let pool: Pool;
  const run = Date.now().toString(36);
  const auth = (x: U | { token: string }) => ({ Authorization: `Bearer ${x.token}` });
  /** Um post com música licenciada, criado com o fornecedor ligado, para ver depois com ele desligado. */
  let storedPostCode = '';

  async function signup(app: INestApplication, name: string, country = 'MZ'): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now(), country = $2 WHERE id = $1', [r.body.user.id, country]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  it('o adaptador simulado é proibido em produção', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production', MUSIC_LICENSED_ENABLED: 'true', MUSIC_LICENSED_DRIVER: 'fake' })).toThrow(/só existe para testes/);
    expect(loadConfig({ ...BASE }).MUSIC_LICENSED_ENABLED).toBe(false);
  });

  describe('ligada (MUSIC_LICENSED_ENABLED=true, adaptador simulado, contrato para MZ e ZA)', () => {
    let app: INestApplication;
    let fake: FakeLicensedProvider;
    const u: Record<string, U> = {};
    const api = () => request(app.getHttpServer());

    beforeAll(async () => {
      app = await createApp(loadConfig({ ...BASE, MUSIC_LICENSED_ENABLED: 'true', MUSIC_LICENSED_DRIVER: 'fake', MUSIC_LICENSED_TERRITORIES: 'MZ,ZA', MUSIC_LICENSED_CLIP_SECONDS: '30' }));
      await app.init();
      fake = app.get(LicensedMusicService).provider('licensed') as FakeLicensedProvider;
      u.mz = await signup(app, 'lma');
      u.pt = await signup(app, 'lmb', 'PT');
      // Uso de outros dias de outras execuções não deve entrar nas contas deste teste.
      await pool.query(`DELETE FROM content.music_usage_daily WHERE source = 'licensed'`);
      await pool.query(`DELETE FROM content.music_usage_reports WHERE source = 'licensed'`);
      await pool.query(`DELETE FROM content.music_takedowns WHERE source = 'licensed'`);
      await pool.query(`DELETE FROM content.music_provider_state WHERE source = 'licensed'`);
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('estado, pesquisa, tops e faixa: só no país do contrato e só as faixas licenciadas nesse país; sem endereço do excerto', async () => {
      expect((await api().get('/api/v1/music/licensed/status').set(auth(u.mz)).expect(200)).body).toEqual({ enabled: true, source: 'licensed', clipSeconds: 30 });
      const found = (await api().get('/api/v1/music/licensed/search?q=amapiano').set(auth(u.mz)).expect(200)).body;
      expect(found).toEqual([{ id: 'lic-2', title: 'Amapiano do Bairro', artist: 'DJ Exemplo', duration: 245, previewUrl: null, cover: null, source: 'licensed', license: 'licensed', styles: ['amapiano'] }]);
      const top = (await api().get('/api/v1/music/licensed/trending').set(auth(u.mz)).expect(200)).body as { id: string }[];
      expect(top.map((t) => t.id)).toEqual(['lic-1', 'lic-2']); // a lic-3 só está licenciada na África do Sul
      await api().get('/api/v1/music/licensed/tracks/lic-3').set(auth(u.mz)).expect(404);
      expect((await api().get('/api/v1/music/licensed/tracks/lic-1').set(auth(u.mz)).expect(200)).body.title).toBe('Marrabenta da Baixa');
      await api().get('/api/v1/music/licensed/search?q=a').set(auth(u.mz)).expect(400);
      await api().get('/api/v1/music/licensed/status').expect(401);

      // Fora dos países do contrato é como se não existisse.
      expect((await api().get('/api/v1/music/licensed/status').set(auth(u.pt)).expect(200)).body).toEqual({ enabled: false });
      await api().get('/api/v1/music/licensed/search?q=amapiano').set(auth(u.pt)).expect(404);
      await api().get('/api/v1/music/licensed/trending').set(auth(u.pt)).expect(404);
      await api().post('/api/v1/music/licensed/tracks/lic-1/listen').set(auth(u.pt)).send({}).expect(404);
    });

    it('ouvir: cada pedido dá um excerto assinado e conta (agregado por dia, faixa, país e tipo, sem quem ouviu)', async () => {
      const a = (await api().post('/api/v1/music/licensed/tracks/lic-1/listen').set(auth(u.mz)).send({ event: 'preview' }).expect(200)).body;
      expect(a.url).toMatch(/^https:\/\/licensed\.invalid\/clip\/lic-1\.m4a\?max=30&c=MZ/);
      expect(a.clipSeconds).toBe(30);
      expect(Date.parse(a.expiresAt)).toBeGreaterThan(Date.now());
      await api().post('/api/v1/music/licensed/tracks/lic-1/listen').set(auth(u.mz)).send({}).expect(200); // por omissão: preview
      await api().post('/api/v1/music/licensed/tracks/lic-1/listen').set(auth(u.mz)).send({ event: 'play' }).expect(200);
      await api().post('/api/v1/music/licensed/tracks/lic-3/listen').set(auth(u.mz)).send({}).expect(404); // não licenciada em MZ
      await api().post('/api/v1/music/licensed/tracks/lic-1/listen').set(auth(u.mz)).send({ event: 'download' }).expect(400);

      const rows = (await pool.query(`SELECT track_id, country, event, count FROM content.music_usage_daily WHERE source = 'licensed' ORDER BY event`)).rows;
      expect(rows).toEqual([
        { track_id: 'lic-1', country: 'MZ', event: 'play', count: 1 },
        { track_id: 'lic-1', country: 'MZ', event: 'preview', count: 2 },
      ]);
      const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'content' AND table_name = 'music_usage_daily'`)).rows.map((r) => r.column_name);
      expect(cols.sort()).toEqual(['count', 'country', 'day', 'event', 'source', 'track_id']); // nada de user_id
    });

    it('publicar com uma faixa licenciada: o servidor vai buscar os dados ao fornecedor e conta a criação; faixas fora do contrato são recusadas', async () => {
      const post = (await api().post('/api/v1/posts').set(auth(u.mz)).send({ body: 'Som licenciado', music: { kind: 'licensed', source: 'licensed', id: 'lic-1', title: 'Título inventado pela app' } }).expect(201)).body;
      expect(post.music).toMatchObject({ kind: 'licensed', source: 'licensed', id: 'lic-1', title: 'Marrabenta da Baixa', artist: 'Banda Exemplo', license: 'licensed', duration: 214, clipSeconds: 30 });
      expect(post.music.url).toBeUndefined();
      storedPostCode = post.code;
      const seen = (await api().get(`/api/v1/posts/code/${post.code}`).set(auth(u.pt)).expect(200)).body;
      expect(seen.music).toMatchObject({ kind: 'licensed', id: 'lic-1' }); // vê-se o crédito; o excerto, fora do contrato, não

      await api().post('/api/v1/posts').set(auth(u.mz)).send({ body: 'x', music: { kind: 'licensed', source: 'licensed', id: 'lic-3' } }).expect(400); // só ZA
      await api().post('/api/v1/posts').set(auth(u.mz)).send({ body: 'x', music: { kind: 'licensed', source: 'outro', id: 'lic-1' } }).expect(400);
      await api().post('/api/v1/posts').set(auth(u.pt)).send({ body: 'x', music: { kind: 'licensed', source: 'licensed', id: 'lic-1' } }).expect(400); // fora do contrato

      await api().put('/api/v1/notes/me').set(auth(u.mz)).send({ body: '', music: { kind: 'licensed', source: 'licensed', id: 'lic-1' } }).expect(204);
      const creates = (await pool.query(`SELECT count FROM content.music_usage_daily WHERE source = 'licensed' AND track_id = 'lic-1' AND event = 'create'`)).rows[0].count;
      expect(creates).toBe(2);
    });

    it('relatório: entrega os dias fechados, por faixa e por país, uma só vez; o de hoje fica para amanhã', async () => {
      const staff = await staffLogin(app, 'musica');
      // O que se contou até agora passa para ontem (um dia fechado); hoje fica uma escuta por entregar.
      await pool.query(`UPDATE content.music_usage_daily SET day = day - 1 WHERE source = 'licensed'`);
      await pool.query(`INSERT INTO content.music_usage_daily (day, source, track_id, country, event, count) VALUES (current_date - 3, 'licensed', 'lic-2', 'ZA', 'play', 7)`);
      await api().post('/api/v1/music/licensed/tracks/lic-2/listen').set(auth(u.mz)).send({}).expect(200);

      const r = (await api().post('/api/v1/admin/music/licensed/report').set(auth(staff)).expect(200)).body;
      expect(r).toEqual({ enabled: true, days: 2, rows: 4, accepted: 4 });
      expect(fake.reported.map((x) => `${x.trackId}/${x.country}/${x.event}=${x.count}`).sort()).toEqual(['lic-1/MZ/create=2', 'lic-1/MZ/play=1', 'lic-1/MZ/preview=2', 'lic-2/ZA/play=7']);
      expect((await api().post('/api/v1/admin/music/licensed/report').set(auth(staff)).expect(200)).body).toMatchObject({ days: 0, rows: 0 });

      const usage = (await api().get('/api/v1/admin/music/licensed/usage').set(auth(staff)).expect(200)).body;
      expect(usage.enabled).toBe(true);
      expect(usage.items).toEqual(expect.arrayContaining([{ trackId: 'lic-1', country: 'MZ', previews: 2, plays: 1, creates: 2 }, { trackId: 'lic-2', country: 'ZA', previews: 0, plays: 7, creates: 0 }]));

      // Só a equipa, e com as permissões certas.
      await api().post('/api/v1/admin/music/licensed/report').set(auth(u.mz)).expect(401);
      const support = await staffLogin(app, 'suporte', ['suporte']);
      await api().post('/api/v1/admin/music/licensed/report').set(auth(support)).expect(403);
    });

    it('remoções: o aviso do fornecedor tira a faixa da pesquisa, dos posts e das notas; a equipa também pode retirar', async () => {
      const staff = await staffLogin(app, 'musica2');
      fake.queueTakedown('lic-1');
      expect((await api().post('/api/v1/admin/music/licensed/takedowns/sync').set(auth(staff)).expect(200)).body).toEqual({ enabled: true, applied: 1 });
      expect((await api().post('/api/v1/admin/music/licensed/takedowns/sync').set(auth(staff)).expect(200)).body).toEqual({ enabled: true, applied: 0 });

      const post = (await api().get(`/api/v1/posts/code/${storedPostCode}`).set(auth(u.mz)).expect(200)).body;
      expect(post.body).toBe('Som licenciado');
      expect(post.music).toBeNull();
      expect((await pool.query('SELECT 1 FROM social.notes WHERE user_id = $1', [u.mz.id])).rowCount).toBe(0); // era só música
      await api().get('/api/v1/music/licensed/tracks/lic-1').set(auth(u.mz)).expect(404);
      await api().post('/api/v1/music/licensed/tracks/lic-1/listen').set(auth(u.mz)).send({}).expect(404);
      await api().post('/api/v1/posts').set(auth(u.mz)).send({ body: 'x', music: { kind: 'licensed', source: 'licensed', id: 'lic-1' } }).expect(400);

      // A equipa retira a lic-2 (por exemplo, uma queixa do titular): sai também dos resultados, mesmo que o fornecedor ainda a liste.
      const p2 = (await api().post('/api/v1/posts').set(auth(u.mz)).send({ body: 'Outro som', music: { kind: 'licensed', source: 'licensed', id: 'lic-2' } }).expect(201)).body;
      const td = (await api().post('/api/v1/admin/music/licensed/takedowns').set(auth(staff)).send({ trackId: 'lic-2', reason: 'Queixa do titular' }).expect(200)).body;
      expect(td).toMatchObject({ new: true, posts: 1 });
      expect((await api().get('/api/v1/music/licensed/search?q=amapiano').set(auth(u.mz)).expect(200)).body).toEqual([]);
      expect((await api().get(`/api/v1/posts/code/${p2.code}`).set(auth(u.mz)).expect(200)).body.music).toBeNull();
      const audit = (await pool.query(`SELECT target FROM audit.audit_log WHERE action = 'music.takedown' AND actor_id = $1`, [staff.userId])).rows;
      expect(audit).toEqual([{ target: 'licensed:lic-2' }]);
    });
  });

  describe('desligada (por omissão)', () => {
    let app: INestApplication;
    let me: U;
    const api = () => request(app.getHttpServer());

    beforeAll(async () => {
      app = await createApp(loadConfig({ ...BASE }));
      await app.init();
      me = await signup(app, 'lmc');
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('fica invisível: o estado diz que não, as rotas não existem, não se publica e o que estava guardado aparece sem música', async () => {
      expect((await api().get('/api/v1/music/licensed/status').set(auth(me)).expect(200)).body).toEqual({ enabled: false });
      await api().get('/api/v1/music/licensed/search?q=amapiano').set(auth(me)).expect(404);
      await api().get('/api/v1/music/licensed/trending').set(auth(me)).expect(404);
      await api().get('/api/v1/music/licensed/tracks/lic-1').set(auth(me)).expect(404);
      await api().post('/api/v1/music/licensed/tracks/lic-1/listen').set(auth(me)).send({}).expect(404);
      await api().post('/api/v1/posts').set(auth(me)).send({ body: 'x', music: { kind: 'licensed', source: 'licensed', id: 'lic-1' } }).expect(400);

      // Um post guardado com música licenciada (escrito à mão, como se viesse de quando estava ligada) vê-se sem a música.
      const p = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'Guardado antes' }).expect(201)).body;
      await pool.query(`UPDATE content.posts SET music = '{"kind":"licensed","source":"licensed","id":"lic-9","title":"Antiga","artist":"X"}' WHERE short_code = $1`, [p.code]);
      expect((await api().get(`/api/v1/posts/code/${p.code}`).set(auth(me)).expect(200)).body.music).toBeNull();

      const staff = await staffLogin(app, 'musica3');
      expect((await api().post('/api/v1/admin/music/licensed/report').set(auth(staff)).expect(200)).body).toEqual({ enabled: false, days: 0, rows: 0, accepted: 0 });
    });
  });
});
