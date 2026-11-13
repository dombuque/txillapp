import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MediaService } from '../media/media.service';
import { staffLogin } from '../staff/staff-test';
import { SoundsService } from './sounds.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const MEDIA_DIR = './uploads-test';

function makeVideo(seconds: number) {
  const dir = mkdtempSync(join(tmpdir(), 'txill-dir-'));
  const file = join(dir, 'v.mp4');
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', `testsrc=size=240x320:rate=15:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-t', String(seconds), file], { stdio: 'ignore' });
  return readFileSync(file);
}

/** O ficheiro do vídeo tem pista de áudio? (o armazenamento local dos testes guarda-o em MEDIA_DIR/<id>) */
function hasAudio(mediaId: string): boolean {
  const out = execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-print_format', 'json', resolve(MEDIA_DIR, mediaId)]).toString();
  return (JSON.parse(out) as { streams: { codec_type: string }[] }).streams.some((s) => s.codec_type === 'audio');
}

interface U { token: string; id: string; username: string }
interface Post { id: string; sound: { id: string } | null; music: Record<string, unknown> | null; soundRemoved: string | null; media: { url: string }[] }
interface Note { kind: string; data: Record<string, unknown>; actor: { username: string; staff?: boolean } }

/** Direitos dos sons (0140): «Retirar o som», os avisos ao autor (suspenso, retirado, reposto) e as tchekas que ficam sem som. */
describe('direitos dos sons: retirar o meu som e avisos ao autor (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let sounds: SoundsService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  let staff = '';

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  async function video(x: U) {
    const bytes = makeVideo(2);
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'video/mp4', size: bytes.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'video/mp4').send(bytes).expect(200);
    const id = up.body.assetId as string;
    await api().post(`/api/v1/media/${id}/complete`).set(auth(x)).expect(200);
    for (let i = 0; i < 80; i++) {
      const s = (await api().get(`/api/v1/media/${id}/status`).set(auth(x)).expect(200)).body as { status: string };
      if (s.status === 'ready') return id;
      if (s.status === 'deleted') throw new Error('vídeo recusado');
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('conversão demorou demais');
  }

  async function tcheka(x: U, extra: Record<string, unknown> = {}): Promise<Post & { mediaId: string }> {
    const mediaId = await video(x);
    const p = (await api().post('/api/v1/posts').set(auth(x)).send({ body: 'tcheka', mediaIds: [mediaId], ...extra }).expect(201)).body as Post;
    await sounds.idle();
    return { ...((await api().get(`/api/v1/posts/${p.id}`).set(auth(x)).expect(200)).body as Post), mediaId };
  }

  const notes = async (x: U) => (await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as Note[];

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'r'.repeat(40), NODE_ENV: 'test', MEDIA_DIR }));
    await app.init();
    sounds = app.get(SoundsService);
    for (const n of ['dana', 'dbea', 'dcid']) u[n] = await signup(n);
    staff = (await staffLogin(app, 'dir', ['moderacao'])).token;
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('«Retirar o som»: deixa de tocar em todo o lado, o áudio é apagado e as tchekas dos outros ficam sem som', async () => {
    const orig = await tcheka(u.dana);
    const id = orig.sound!.id;
    const used = await tcheka(u.dbea, { soundId: id });
    const mineToo = await tcheka(u.dana, { soundId: id });
    expect(hasAudio(used.mediaId)).toBe(true);
    const audio = (await pool.query('SELECT audio_media_id FROM content.sounds WHERE id = $1', [id])).rows[0].audio_media_id as string;
    const preview = (await api().get(`/api/v1/sounds/${id}`).set(auth(u.dbea)).expect(200)).body.previewUrl as string;

    // Só o autor; ids inválidos e sons de faixas não dão.
    await api().post(`/api/v1/sounds/${id}/retire`).set(auth(u.dbea)).expect(404);
    await api().post('/api/v1/sounds/cat:qualquer/retire').set(auth(u.dana)).expect(404);
    // Uma denúncia por analisar fecha-se quando o autor retira.
    await api().post(`/api/v1/sounds/${id}/report`).set(auth(u.dcid)).send({ reason: 'copyright' }).expect(204);

    await api().post(`/api/v1/sounds/${id}/retire`).set(auth(u.dana)).expect(204);
    await api().post(`/api/v1/sounds/${id}/retire`).set(auth(u.dana)).expect(404); // já não existe
    await sounds.idle();

    // O som deixa de existir e de se usar; o áudio já não se serve e sai do armazenamento.
    await api().get(`/api/v1/sounds/${id}`).set(auth(u.dbea)).expect(404);
    await api().get(preview).expect(404);
    { const v = await video(u.dcid); await api().post('/api/v1/posts').set(auth(u.dcid)).send({ body: 'x', mediaIds: [v], soundId: id }).expect(404); }
    expect((await pool.query('SELECT status FROM content.media_assets WHERE id = $1', [audio])).rows[0].status).toBe('deleted');
    await app.get(MediaService).sweepDeleted();
    expect(existsSync(resolve(MEDIA_DIR, audio))).toBe(false);
    expect((await pool.query('SELECT audio_media_id, removed_by, silenced_at FROM content.sounds WHERE id = $1', [id])).rows[0]).toMatchObject({ audio_media_id: null, removed_by: 'author' });
    expect((await pool.query(`SELECT status FROM content.sound_reports WHERE sound_id = $1`, [id])).rows.map((r) => r.status)).toEqual(['upheld']);

    // As tchekas que usavam o som (também as do próprio autor) ficam sem som e dizem porquê; a de onde saiu fica como estava.
    const after = (await api().get(`/api/v1/posts/${used.id}`).set(auth(u.dcid)).expect(200)).body as Post;
    expect(after).toMatchObject({ sound: null, music: null, soundRemoved: 'author' });
    expect(hasAudio(used.mediaId)).toBe(false);
    expect(hasAudio(mineToo.mediaId)).toBe(false);
    expect(hasAudio(orig.mediaId)).toBe(true);
    expect(((await api().get(`/api/v1/posts/${orig.id}`).set(auth(u.dcid)).expect(200)).body as Post).soundRemoved).toBeNull();
    expect((await pool.query('SELECT silenced_at FROM content.sounds WHERE id = $1', [id])).rows[0].silenced_at).not.toBeNull();
    // Sem cópia com o som (não se desfaz) e quem usou não é avisado.
    expect(existsSync(resolve(MEDIA_DIR, `${used.mediaId}.sound`))).toBe(false);
    expect((await notes(u.dbea)).some((n) => n.kind === 'sound_review')).toBe(false);

    // Em «Os meus sons» fica como retirado por mim; a equipa não o pode repor.
    const mine = (await api().get('/api/v1/sounds/me').set(auth(u.dana)).expect(200)).body as { id: string; status: string; removedBy: string | null }[];
    expect(mine.find((s) => s.id === id)).toMatchObject({ status: 'removed', removedBy: 'author' });
    await api().post(`/api/v1/admin/sounds/${id}/decision`).set({ Authorization: `Bearer ${staff}` }).send({ action: 'restore', reason: 'Engano' }).expect(400);
    const audit = await pool.query(`SELECT action FROM audit.audit_log WHERE target = $1`, [`sound:${id}`]);
    expect(audit.rows.map((r) => r.action)).toContain('sound.retire');
  }, 240_000);

  it('retirar depois de apagar a tcheka de onde o som saiu (o som continuava a tocar nas outras)', async () => {
    const orig = await tcheka(u.dana);
    const used = await tcheka(u.dbea, { soundId: orig.sound!.id });
    await api().delete(`/api/v1/posts/${orig.id}`).set(auth(u.dana)).expect(204);
    expect((await api().get('/api/v1/sounds/me').set(auth(u.dana)).expect(200)).body.find((s: { id: string }) => s.id === orig.sound!.id).status).toBe('source_removed');
    await api().post(`/api/v1/sounds/${orig.sound!.id}/retire`).set(auth(u.dana)).expect(204);
    await sounds.idle();
    expect(hasAudio(used.mediaId)).toBe(false);
  }, 180_000);

  it('avisos ao autor: suspenso por denúncia, retirado pela equipa (com cópia para repor) e reposto', async () => {
    const orig = await tcheka(u.dana);
    const id = orig.sound!.id;
    const used = await tcheka(u.dbea, { soundId: id });

    // Suspenso: o aviso vem do Txillapp (nunca de quem denunciou), com o motivo e a tcheka; uma segunda denúncia não repete.
    await api().post(`/api/v1/sounds/${id}/report`).set(auth(u.dcid)).send({ reason: 'copyright', note: 'é da rádio' }).expect(204);
    await api().post(`/api/v1/sounds/${id}/report`).set(auth(u.dbea)).send({ reason: 'other' }).expect(204);
    let mine = (await notes(u.dana)).filter((n) => n.kind === 'sound_review' && n.data.soundId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ actor: { username: 'txillapp', staff: true }, data: { decision: 'held', reason: 'Música protegida denunciada', postId: orig.id } });
    expect(JSON.stringify(mine)).not.toContain(u.dcid.username);
    expect(JSON.stringify(mine)).not.toContain('é da rádio');
    // Um bloqueio entre o autor e quem denunciou não esconde o aviso.
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.dana.id, u.dcid.id]);
    expect((await notes(u.dana)).some((n) => n.kind === 'sound_review' && n.data.soundId === id)).toBe(true);
    await pool.query('DELETE FROM social.blocks WHERE blocker_id = $1', [u.dana.id]);

    // Retirado pela equipa: o aviso diz o motivo da denúncia e a nota da equipa; o vídeo de quem usou fica sem som, com cópia.
    await api().post(`/api/v1/admin/sounds/${id}/decision`).set({ Authorization: `Bearer ${staff}` }).send({ action: 'uphold', reason: 'É uma música da rádio' }).expect(204);
    await sounds.idle();
    mine = (await notes(u.dana)).filter((n) => n.kind === 'sound_review' && n.data.soundId === id);
    expect(mine[0]).toMatchObject({ actor: { username: 'txillapp' }, data: { decision: 'removed', reason: 'Música protegida denunciada', note: 'É uma música da rádio' } });
    expect(((await api().get(`/api/v1/posts/${used.id}`).set(auth(u.dcid)).expect(200)).body as Post).soundRemoved).toBe('rights');
    expect(hasAudio(used.mediaId)).toBe(false);
    expect(existsSync(resolve(MEDIA_DIR, `${used.mediaId}.sound`))).toBe(true);
    expect((await pool.query('SELECT removed_by FROM content.sounds WHERE id = $1', [id])).rows[0].removed_by).toBe('staff');

    // Reposto: o som volta a tocar, também no vídeo de quem o usou, e o autor é avisado.
    await api().post(`/api/v1/admin/sounds/${id}/decision`).set({ Authorization: `Bearer ${staff}` }).send({ action: 'restore', reason: 'Engano' }).expect(204);
    await sounds.idle();
    expect(hasAudio(used.mediaId)).toBe(true);
    expect(existsSync(resolve(MEDIA_DIR, `${used.mediaId}.sound`))).toBe(false);
    const back = (await api().get(`/api/v1/posts/${used.id}`).set(auth(u.dcid)).expect(200)).body as Post;
    expect(back).toMatchObject({ soundRemoved: null, sound: { id } });
    expect((await notes(u.dana)).find((n) => n.kind === 'sound_review' && n.data.soundId === id)?.data.decision).toBe('restored');

    // Sem razão: deixa de estar em análise e o autor sabe.
    const other = await tcheka(u.dana);
    await api().post(`/api/v1/sounds/${other.sound!.id}/report`).set(auth(u.dbea)).send({ reason: 'other' }).expect(204);
    expect((await notes(u.dana)).find((n) => n.kind === 'sound_review' && n.data.soundId === other.sound!.id)?.data).toMatchObject({ decision: 'held', reason: 'Denunciado por outro motivo' });
    await api().post(`/api/v1/admin/sounds/${other.sound!.id}/decision`).set({ Authorization: `Bearer ${staff}` }).send({ action: 'dismiss', reason: 'Som próprio' }).expect(204);
    expect((await notes(u.dana)).find((n) => n.kind === 'sound_review' && n.data.soundId === other.sound!.id)?.data.decision).toBe('cleared');
  }, 240_000);

  it('eliminar a conta: as tchekas de outros que usavam os meus sons ficam sem som (sem cópia)', async () => {
    const del = await signup('ddel');
    const orig = await tcheka(del);
    const used = await tcheka(u.dbea, { soundId: orig.sound!.id });
    await api().post('/api/v1/auth/delete-account').set(auth(del)).send({ confirmUsername: del.username, password: PASSWORD }).expect(204);
    await sounds.queueSilence();
    expect(hasAudio(used.mediaId)).toBe(false);
    expect(existsSync(resolve(MEDIA_DIR, `${used.mediaId}.sound`))).toBe(false);
    expect(((await api().get(`/api/v1/posts/${used.id}`).set(auth(u.dcid)).expect(200)).body as Post).soundRemoved).toBe('author');
  }, 180_000);
});

