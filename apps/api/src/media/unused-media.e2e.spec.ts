import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { uuidv7 } from '../common/uuid7';
import { MEDIA_COLUMN_REFS } from './media-refs';
import { MediaService } from './media.service';
import { UnusedMediaService } from './unused-media.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const VOICE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
const PASSWORD = 'password-bem-longa-1';
const DIR = resolve('./uploads-test');

interface U { token: string; id: string; username: string }

describe('envios por publicar: apagam-se 48 horas depois, só os que ninguém usa (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let unused: UnusedMediaService;
  let media: MediaService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  async function upload(a: U, mime = 'image/png', bytes = PNG, purpose: 'public' | 'chat' = 'public') {
    const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime, size: bytes.length, purpose }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
    return r.body.assetId as string;
  }

  /** Recua a hora do envio (o ficheiro passa a ter `hours` horas). */
  const age = (id: string, hours: number) => pool.query(`UPDATE content.media_assets SET created_at = now() - make_interval(hours => $2) WHERE id = $1`, [id, hours]);
  const row = async (id: string) => (await pool.query('SELECT status FROM content.media_assets WHERE id = $1', [id])).rows[0] as { status: string } | undefined;
  const onDisk = (id: string) => existsSync(join(DIR, id));

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    unused = app.get(UnusedMediaService);
    media = app.get(MediaService);
    for (const n of ['ea', 'eb', 'ec']) u[n] = await signup(n);
    for (const a of [u.ea.id, u.eb.id]) for (const b of [u.ea.id, u.eb.id]) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('cada chave estrangeira para content.media_assets na base de dados está na lista das referências', async () => {
    const { rows } = await pool.query(
      `SELECT n.nspname || '.' || c.relname AS tbl, a.attname AS col
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
        WHERE k.contype = 'f' AND k.confrelid = 'content.media_assets'::regclass`,
    );
    const listed = new Set(MEDIA_COLUMN_REFS.map((r) => `${r.table}.${r.column}`));
    expect(rows.map((r) => `${r.tbl}.${r.col}`).filter((k) => !listed.has(k))).toEqual([]);
  });

  it('sem uso há mais de 48 horas: sai do armazenamento (com as larguras e a capa) e da base de dados; com menos, fica', async () => {
    const old = await upload(u.ea);
    const fresh = await upload(u.ea);
    const chatOld = await upload(u.ea, 'audio/webm', VOICE, 'chat'); // a voz de uma mensagem cujo envio falhou
    writeFileSync(join(DIR, `${old}.480.webp`), 'x');
    writeFileSync(join(DIR, `${old}.poster.jpg`), 'x');
    await age(old, 49);
    await age(chatOld, 72);
    await age(fresh, 47);
    expect(onDisk(old)).toBe(true);

    expect(await unused.run()).toBeGreaterThanOrEqual(2);
    expect(await row(old)).toBeUndefined();
    expect(onDisk(old)).toBe(false);
    expect(existsSync(join(DIR, `${old}.480.webp`))).toBe(false);
    expect(existsSync(join(DIR, `${old}.poster.jpg`))).toBe(false);
    expect(await row(chatOld)).toBeUndefined();
    expect(onDisk(chatOld)).toBe(false);
    expect(await row(fresh)).toMatchObject({ status: 'ready' });
    expect(onDisk(fresh)).toBe(true);
  });

  it('em uso numa publicação, numa mensagem, num som, na foto de perfil ou na música de uma publicação: fica, mesmo com mais de 48 horas', async () => {
    const { ea, eb } = u;
    const inPost = await upload(ea);
    await api().post('/api/v1/posts').set(auth(ea)).send({ body: 'foto', mediaIds: [inPost] }).expect(201);

    const inMessage = await upload(ea, 'image/png', PNG, 'chat');
    await api().post(`/api/v1/chat/with/${eb.username}`).set(auth(ea)).send({ kind: 'image', mediaId: inMessage, body: 'olha' }).expect(201);
    const voice = await upload(ea, 'audio/webm', VOICE, 'chat');
    await api().post(`/api/v1/chat/with/${eb.username}`).set(auth(ea)).send({ kind: 'voice', mediaId: voice, durationMs: 4200 }).expect(201);

    const avatar = await upload(ea);
    await api().put('/api/v1/users/me/avatar').set(auth(ea)).send({ mediaId: avatar }).expect(200);

    // O áudio de um som original (guardado no servidor, privado) e a capa (o vídeo da tcheka).
    const soundAudio = await media.storeDerived(ea.id, Buffer.from('audio'), 'audio/mp4', 'music', 2000);
    const soundCover = await upload(ea);
    await pool.query(
      `INSERT INTO content.sounds (id, kind, owner_id, title, audio_media_id, cover_media_id) VALUES ($1, 'original', $2, 'Som original', $3, $4)`,
      [`orig:${run}`, ea.id, soundAudio, soundCover],
    );

    // Um clipe de áudio meu como música de uma publicação (fica no jsonb `music`).
    const clip = await upload(ea, 'audio/webm', VOICE, 'chat');
    await api().post('/api/v1/posts').set(auth(ea)).send({ body: 'com áudio meu', music: { kind: 'clip', mediaId: clip, durationMs: 5000 } }).expect(201);

    // Uma foto assinalada pela verificação automática, com a denúncia por decidir.
    const flagged = await upload(ea);
    await pool.query(
      `INSERT INTO social.reports (id, reporter_id, target_type, target_id, target_user_id, reason, note) VALUES ($1, NULL, 'media', $2, $3, 'nudity', 'teste')`,
      [uuidv7(), flagged, ea.id],
    );

    const kept = { inPost, inMessage, voice, avatar, soundAudio, soundCover, clip, flagged };
    for (const id of Object.values(kept)) await age(id, 24 * 30);
    await unused.run();
    for (const [what, id] of Object.entries(kept)) {
      expect([what, await row(id)]).toEqual([what, expect.objectContaining({ status: 'ready' })]);
      expect([what, onDisk(id)]).toEqual([what, true]);
    }

    // A foto de perfil trocada deixa de estar em uso: sai na limpeza seguinte.
    const next = await upload(ea);
    await api().put('/api/v1/users/me/avatar').set(auth(ea)).send({ mediaId: next }).expect(200);
    await unused.run();
    expect(await row(avatar)).toBeUndefined();
    expect(await row(next)).toMatchObject({ status: 'ready' });
  });

  it('montagem no servidor: os clipes e a voz-off de um pedido ativo ficam; acabado o pedido, saem, e o vídeo montado por publicar também', async () => {
    const { ec } = u;
    const clipA = await upload(ec);
    const clipB = await upload(ec);
    const voiceOver = await upload(ec, 'audio/webm', VOICE, 'chat');
    const spec = { v: 1, username: ec.username, clips: [{ mediaId: clipA, kind: 'photo' }, { mediaId: clipB, kind: 'photo' }], mix: { voice: { mediaId: voiceOver, start: 0, volume: 1, fx: 'normal' } } };
    const job = uuidv7();
    await pool.query(`INSERT INTO content.compose_jobs (id, owner_id, status, spec) VALUES ($1, $2, 'queued', $3)`, [job, ec.id, JSON.stringify(spec)]);
    for (const id of [clipA, clipB, voiceOver]) await age(id, 50);

    await unused.run();
    for (const id of [clipA, clipB, voiceOver]) expect(await row(id)).toMatchObject({ status: 'ready' });
    await pool.query(`UPDATE content.compose_jobs SET status = 'working' WHERE id = $1`, [job]);
    await unused.run();
    for (const id of [clipA, clipB, voiceOver]) expect(await row(id)).toMatchObject({ status: 'ready' });

    // O pedido acabou e o vídeo montado (público, pronto e assinado) nunca foi num POST /posts.
    const montado = await upload(ec);
    await pool.query(`UPDATE content.compose_jobs SET status = 'done', media_id = $2, finished_at = now() WHERE id = $1`, [job, montado]);
    await age(montado, 49);
    await unused.run();
    for (const id of [clipA, clipB, voiceOver, montado]) {
      expect(await row(id)).toBeUndefined();
      expect(onDisk(id)).toBe(false);
    }
    // O pedido fica (sai ao fim de 7 dias), sem o vídeo.
    expect((await pool.query('SELECT status, media_id FROM content.compose_jobs WHERE id = $1', [job])).rows[0]).toEqual({ status: 'done', media_id: null });
  });

  it('a exportação traz os envios por publicar do próprio, com o prazo, e não os que estão em uso', async () => {
    const { eb } = u;
    const waiting = await upload(eb);
    const waitingVoice = await upload(eb, 'audio/webm', VOICE, 'chat');
    const used = await upload(eb);
    await api().post('/api/v1/posts').set(auth(eb)).send({ body: 'publicada', mediaIds: [used] }).expect(201);
    const other = await upload(u.ec); // de outra pessoa: nunca entra

    const r = await api().get('/api/v1/me/export').set(auth(eb)).expect(200);
    const data = JSON.parse(r.text) as { pendingUploads: { id: string; kind: string; url: string | null; uploadedAt: string; deletedAfter: string }[] };
    const ids = data.pendingUploads.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([waiting, waitingVoice]));
    expect(ids).not.toContain(used);
    expect(ids).not.toContain(other);
    const photo = data.pendingUploads.find((p) => p.id === waiting)!;
    expect(photo).toMatchObject({ kind: 'photo', url: `/api/v1/media/${waiting}` });
    expect(new Date(photo.deletedAfter).getTime() - new Date(photo.uploadedAt).getTime()).toBe(48 * 3_600_000);
    const voice = data.pendingUploads.find((p) => p.id === waitingVoice)!;
    expect(voice.kind).toBe('audio');
    await api().get(voice.url!).expect(200); // o do chat vai com um endereço assinado
  });
});
