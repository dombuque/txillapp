import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { uuidv7 } from '../common/uuid7';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { VideoService } from '../media/video.service';
import { ComposeService, RESTART_ERROR } from './compose.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Svc = { workerId: string; render: (spec: { m: string }) => Promise<unknown>; store: () => Promise<null> };

/**
 * As filas partilhadas (docs/escala.md): dois workers na mesma base de dados. Cada trabalho da montagem (e cada vídeo) é
 * apanhado por um só (UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)) e corre uma vez.
 */
describe('fila da montagem e dos vídeos com dois workers (integração)', () => {
  let a: INestApplication;
  let b: INestApplication;
  let pool: Pool;
  let owners: string[] = [];
  const run = Date.now().toString(36);
  const env = () => loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'q'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ROLE: 'worker' });
  const insertJobs = async () => {
    const ids: string[] = [];
    for (const o of owners) {
      const id = uuidv7();
      ids.push(id);
      await pool.query(`INSERT INTO content.compose_jobs (id, owner_id, spec) VALUES ($1, $2, $3)`, [id, o, JSON.stringify({ m: id })]);
    }
    return ids;
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    a = await createApp(env());
    await a.init();
    b = await createApp(env());
    await b.init();
    for (let i = 0; i < 6; i++) {
      const username = `fq${i}${run}`.slice(0, 28);
      const r = await request(a.getHttpServer()).post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Fila Teste', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
      owners.push(r.body.user.id as string);
    }
  }, 60_000);

  afterAll(async () => {
    await pool.query(`UPDATE content.compose_jobs SET status = 'failed' WHERE owner_id = ANY($1::uuid[]) AND status IN ('queued', 'working')`, [owners]);
    await a.close();
    await b.close();
    await pool.end();
  });

  it('dois workers a pedir trabalho ao mesmo tempo: cada trabalho é apanhado uma só vez', async () => {
    const ids = await insertJobs();
    const sa = a.get(ComposeService);
    const sb = b.get(ComposeService);
    expect(sa.workerId).not.toBe(sb.workerId);
    const got = (await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? sa : sb).claim()))).filter((j) => j && ids.includes(j.id));
    const claimed = got.map((j) => j!.id);
    expect(claimed.sort()).toEqual([...ids].sort()); // todos, e nenhum duas vezes
    const rows = (await pool.query(`SELECT status, worker_id, heartbeat_at FROM content.compose_jobs WHERE id = ANY($1::uuid[])`, [ids])).rows;
    expect(rows.every((r) => r.status === 'working' && [sa.workerId, sb.workerId].includes(r.worker_id) && r.heartbeat_at)).toBe(true);
    await pool.query(`UPDATE content.compose_jobs SET status = 'failed' WHERE id = ANY($1::uuid[])`, [ids]);
  });

  it('com as duas filas a correr, cada montagem corre uma vez (e as duas trabalham)', async () => {
    const ran: { id: string; by: string }[] = [];
    for (const app of [a, b]) {
      const svc = app.get(ComposeService) as unknown as Svc;
      svc.render = async (spec) => {
        ran.push({ id: spec.m, by: svc.workerId });
        await sleep(120);
        return { file: '', poster: '', seconds: 1, width: 1, height: 1, timings: { prep: 0, clips: 0, final: 0, layers: 0, transitions: 0, reverse: 0 } };
      };
      svc.store = async () => null;
    }
    const ids = await insertJobs();
    await Promise.all([a.get(ComposeService).pump(), b.get(ComposeService).pump()]);
    let left = ids.length;
    for (let i = 0; i < 60 && left; i++) {
      await sleep(100);
      left = (await pool.query(`SELECT count(*)::int AS n FROM content.compose_jobs WHERE id = ANY($1::uuid[]) AND status <> 'done'`, [ids])).rows[0].n as number;
    }
    expect(left).toBe(0);
    const mine = ran.filter((r) => ids.includes(r.id));
    expect(mine.map((r) => r.id).sort()).toEqual([...ids].sort());
    expect(new Set(mine.map((r) => r.by)).size).toBe(2);
  }, 30_000);

  it('depois de cair: só os trabalhos sem sinal de vida passam a falhados (os de outro worker vivo ficam)', async () => {
    const [dead, alive] = [uuidv7(), uuidv7()];
    await pool.query(`INSERT INTO content.compose_jobs (id, owner_id, status, spec, started_at, worker_id, heartbeat_at) VALUES ($1, $2, 'working', '{}', now(), 'outro:1:caido', now() - interval '10 minutes')`, [dead, owners[0]]);
    await pool.query(`INSERT INTO content.compose_jobs (id, owner_id, status, spec, started_at, worker_id, heartbeat_at) VALUES ($1, $2, 'working', '{}', now(), $3, now())`, [alive, owners[1], b.get(ComposeService).workerId]);
    await a.get(ComposeService).recover();
    const st = async (id: string) => (await pool.query('SELECT status, error FROM content.compose_jobs WHERE id = $1', [id])).rows[0];
    expect(await st(dead)).toMatchObject({ status: 'failed', error: RESTART_ERROR });
    expect((await st(alive)).status).toBe('working');
    await pool.query(`UPDATE content.compose_jobs SET status = 'failed' WHERE id = $1`, [alive]);
  });

  it('vídeos: dois workers a pedir ao mesmo tempo apanham cada vídeo uma vez', async () => {
    const ids: string[] = [];
    for (const o of owners) {
      const id = uuidv7();
      ids.push(id);
      await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose, status) VALUES ($1, $2, 'video/mp4', 10, $3, 'public', 'processing')`, [id, o, id]);
      await pool.query(`INSERT INTO content.video_jobs (media_id, owner_id) VALUES ($1, $2)`, [id, o]);
    }
    const va = a.get(VideoService);
    const vb = b.get(VideoService);
    const got = (await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? va : vb).claim()))).filter((j) => j && ids.includes(j.media_id));
    expect(got.map((j) => j!.media_id).sort()).toEqual([...ids].sort());
    const rows = (await pool.query(`SELECT status, attempts FROM content.video_jobs WHERE media_id = ANY($1::uuid[])`, [ids])).rows;
    expect(rows.every((r) => r.status === 'working' && r.attempts === 1)).toBe(true);
    await pool.query('DELETE FROM content.media_assets WHERE id = ANY($1::uuid[])', [ids]); // e os trabalhos, em cascata
    expect((await pool.query('SELECT count(*)::int AS n FROM content.video_jobs WHERE media_id = ANY($1::uuid[])', [ids])).rows[0].n).toBe(0);
  });
});
