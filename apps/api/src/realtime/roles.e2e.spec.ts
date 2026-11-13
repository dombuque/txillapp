import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { uuidv7 } from '../common/uuid7';
import { ComposeService } from '../compose/compose.service';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { VideoService } from '../media/video.service';
import { Scheduler } from './scheduler';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

/**
 * Os papéis dos processos (docs/escala.md): ROLE=web não corre tarefas periódicas nem filas; ROLE=worker corre-as todas.
 * As duas apps usam NODE_ENV=development para as tarefas arrancarem a sério (nos testes ficam paradas), na mesma base de
 * dados e sem Redis: um trabalho posto na fila pela web é apanhado pelo worker pela volta à fila (a fila é a tabela).
 */
describe('papéis: web e worker (integração)', () => {
  let web: INestApplication;
  let worker: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const env = (ROLE: 'web' | 'worker') => loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'r'.repeat(40), NODE_ENV: 'development', MEDIA_DIR: './uploads-test', ROLE });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    web = await createApp(env('web'));
    await web.init();
    worker = await createApp(env('worker'));
    await worker.init();
  }, 60_000);

  afterAll(async () => {
    await web.close();
    await worker.close();
    await pool.end();
  });

  it('ROLE=web: nenhuma tarefa periódica nem fila; ROLE=worker: todas', () => {
    expect(web.get(Scheduler).planned()).toEqual([]);
    expect(web.get(ComposeService).runsQueue).toBe(false);
    expect(web.get(VideoService).runsQueue).toBe(false);

    const here = worker.get(Scheduler).planned();
    expect(here).toEqual(
      expect.arrayContaining([
        'analytics.user_days', 'search.purge', 'chat.expiry', 'gelada.friday', 'geleira.level', 'invites.sweep', 'media.unused',
        'moderation.evidence', 'music.catalog', 'music.catalog.stale', 'nearby.presence', 'reminders.comeback', 'reminders.verify',
        'sounds.backfill', 'sounds.silence', 'calls.sweep', 'calls.purge', 'media.deleted', 'instants.thumbs', 'posts.topics',
        'compose.sweep', 'compose.poll', 'compose.stale', 'video.poll', 'video.stale',
      ]),
    );
    expect(worker.get(ComposeService).runsQueue).toBe(true);
    expect(worker.get(VideoService).runsQueue).toBe(true);
    // As mesmas tarefas ficam registadas na web (só não correm): nenhuma escapa ao Scheduler. As das filas nem se registam.
    const queues = new Set(['compose.poll', 'compose.stale', 'video.poll', 'video.stale']);
    expect(web.get(Scheduler).list().map((t) => t.name).sort()).toEqual(worker.get(Scheduler).list().map((t) => t.name).filter((n) => !queues.has(n)).sort());
  });

  it('a montagem posta na fila pela web corre no worker (e a web nunca lhe pega)', async () => {
    const reg = await request(web.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: `rol${run}@example.com`, username: `rol${run}`.slice(0, 28), displayName: 'Rol Teste', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true })
      .expect(201);
    const owner = reg.body.user.id as string;
    const ran: string[] = [];
    const svcWorker = worker.get(ComposeService) as unknown as { render: (spec: { m: string }) => Promise<unknown>; store: () => Promise<null> };
    svcWorker.render = async (spec) => {
      ran.push(spec.m);
      return { file: '', poster: '', seconds: 1, width: 1, height: 1, timings: { prep: 0, clips: 0, final: 0, layers: 0, transitions: 0, reverse: 0 } };
    };
    svcWorker.store = async () => null;
    const webSvc = web.get(ComposeService) as unknown as { render: () => never };
    webSvc.render = () => {
      throw new Error('a web não monta');
    };

    const id = uuidv7();
    await pool.query(`INSERT INTO content.compose_jobs (id, owner_id, spec) VALUES ($1, $2, $3)`, [id, owner, JSON.stringify({ m: id })]);
    await web.get(ComposeService).pump(); // na web não faz nada
    expect((await pool.query('SELECT status FROM content.compose_jobs WHERE id = $1', [id])).rows[0].status).toBe('queued');

    // Sem Redis o toque não chega ao outro processo: o worker apanha-o na volta de 2 s.
    let st = '';
    for (let i = 0; i < 40 && st !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 250));
      st = (await pool.query('SELECT status FROM content.compose_jobs WHERE id = $1', [id])).rows[0].status as string;
    }
    expect(st).toBe('done');
    expect(ran).toEqual([id]);
    const row = (await pool.query('SELECT worker_id FROM content.compose_jobs WHERE id = $1', [id])).rows[0];
    expect(row.worker_id).toBe(worker.get(ComposeService).workerId);
  }, 30_000);
});
