import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MusicCatalogService } from '../music/catalog/catalog.service';
import { staffLogin } from '../staff/staff-test';
import { SoundsService, parseSoundId } from './sounds.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;

/** Vídeo de teste: barras de cor e um apito (`silent`: com a pista de áudio, mas muda). */
function makeVideo(seconds: number, silent = false) {
  const dir = mkdtempSync(join(tmpdir(), 'txill-som-'));
  const file = join(dir, 'v.mp4');
  const audio = silent ? `anullsrc=r=44100:cl=stereo` : `sine=frequency=523:duration=${seconds}`;
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', `testsrc=size=240x320:rate=15:duration=${seconds}`, '-f', 'lavfi', '-i', audio, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-t', String(seconds), file], { stdio: 'ignore' });
  return readFileSync(file);
}

interface U { token: string; id: string; username: string }
interface Post { id: string; code: string; sound: { id: string; title: string; kind: string; author?: { username: string } } | null; music: Record<string, unknown> | null }

describe('sons das tchekas: som original, usar um som, em alta, visibilidade, desligar e denúncias (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let sounds: SoundsService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const catId = `som-${run}`;
  let staff = '';

  async function signup(name: string, birthDate = '1990-06-15'): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate, acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  async function video(x: U, silent = false) {
    const bytes = makeVideo(2, silent);
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

  /** Publica uma tcheka e espera pelo som original (se houver). */
  async function tcheka(x: U, extra: Record<string, unknown> = {}, silent = false): Promise<Post> {
    const mediaId = await video(x, silent);
    const p = (await api().post('/api/v1/posts').set(auth(x)).send({ body: 'tcheka #som', mediaIds: [mediaId], ...extra }).expect(201)).body as Post;
    await sounds.idle();
    return (await api().get(`/api/v1/posts/${p.id}`).set(auth(x)).expect(200)).body as Post;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    sounds = app.get(SoundsService);
    // Sem a fonte local (os artistas têm os testes deles) e com uma faixa do catálogo já curada. Nada sai da máquina.
    app.get(MusicCatalogService).registerLocalSource(null);
    const track = { id: catId, title: 'Marrabenta do som', artist: 'Artista Livre', duration: 90, previewUrl: 'https://cdn.freesound.org/previews/1/1_1-hq.mp3', cover: null, source: 'ccmixter', license: 'by', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', landing: 'https://ccmixter.org/files/x/1', styles: ['marrabenta'], kind: 'music' };
    await pool.query(
      `INSERT INTO content.music_catalog (id, source, kind, track, styles, quality) VALUES ($1, 'ccmixter', 'music', $2, '{marrabenta}', 0.8)
       ON CONFLICT (id) DO UPDATE SET track = EXCLUDED.track, refreshed_at = now()`,
      [catId, JSON.stringify(track)],
    );
    app.get(MusicCatalogService).invalidate();
    for (const n of ['sana', 'sbea', 'scid', 'spri', 'sdel']) u[n] = await signup(n);
    u.smen = await signup('smen', '2010-06-01'); // 16 anos
    // bea segue a ana e a conta privada; o cid não segue ninguém.
    for (const [a, b] of [['sbea', 'sana'], ['sbea', 'spri']]) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u[a].id, u[b].id]);
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [u.spri.id]);
    staff = (await staffLogin(app, 'som', ['moderacao'])).token;
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('os ids dos sons: uuid (original), cat:<faixa> e local:<uuid>', () => {
    expect(parseSoundId('0190d3c4-0000-7000-8000-000000000001')).toEqual({ kind: 'original', id: '0190d3c4-0000-7000-8000-000000000001' });
    expect(parseSoundId('cat:ccmixter:16626')).toEqual({ kind: 'catalog', id: 'cat:ccmixter:16626', trackId: 'ccmixter:16626' });
    expect(parseSoundId('local:0190d3c4-0000-7000-8000-000000000001')).toMatchObject({ kind: 'local', trackId: 'local:0190d3c4-0000-7000-8000-000000000001' });
    expect(parseSoundId('cat:local:0190d3c4-0000-7000-8000-000000000001')).toBeNull();
    expect(parseSoundId('../etc')).toBeNull();
  });

  let original: Post;
  let reused: Post;

  it('publicar uma tcheka com o som do vídeo tira o som original (com a capa, o título e o áudio); um vídeo mudo não dá som', async () => {
    original = await tcheka(u.sana);
    expect(original.sound).toMatchObject({ kind: 'original', title: `Som original · @${u.sana.username}`, author: { username: u.sana.username } });
    const s = (await api().get(`/api/v1/sounds/${original.sound!.id}`).set(auth(u.sbea)).expect(200)).body;
    expect(s).toMatchObject({ id: original.sound!.id, kind: 'original', uses: 1, canUse: true, mine: false, sourcePost: { id: original.id } });
    expect(s.cover).toMatch(/\?poster=1$/);
    expect(s.durationMs).toBeGreaterThan(1500);
    expect(s.durationMs).toBeLessThanOrEqual(60_000);
    const audio = await api().get(s.previewUrl).expect(200);
    expect(audio.headers['content-type']).toMatch(/audio\/mp4/);
    await api().get(s.previewUrl.replace(/sig=[^&]+/, 'sig=errada')).expect(403);
    expect((await api().get(`/api/v1/sounds/${original.sound!.id}`).set(auth(u.sana)).expect(200)).body.mine).toBe(true);

    const mute = await tcheka(u.sana, {}, true);
    expect(mute.sound).toBeNull();
    // Uma tcheka com música do catálogo não dá som original: liga-se ao som da faixa.
    const withMusic = await tcheka(u.sbea, { music: { id: catId, title: 'x', artist: 'y', url: 'https://cdn.freesound.org/previews/1/1_1-hq.mp3', license: 'by' } });
    expect(withMusic.sound).toMatchObject({ id: `cat:${catId}`, kind: 'catalog', title: 'Marrabenta do som' });
  }, 120_000);

  it('«Usar este som»: a tcheka nova fica ligada ao som, toca o áudio dele, conta nos usos e aparece na grelha', async () => {
    reused = await tcheka(u.sbea, { soundId: original.sound!.id });
    expect(reused.sound?.id).toBe(original.sound!.id);
    expect(reused.music).toMatchObject({ kind: 'sound', soundId: original.sound!.id, title: `Som original · @${u.sana.username}`, license: 'own' });
    expect(String(reused.music!.url)).toMatch(/^\/api\/v1\/sounds\/audio\//);
    expect(reused.music).not.toHaveProperty('audioMediaId');
    expect((await api().get(`/api/v1/sounds/${original.sound!.id}`).set(auth(u.scid)).expect(200)).body.uses).toBe(2);

    const grid = (await api().get(`/api/v1/sounds/${original.sound!.id}/tchekas`).set(auth(u.scid)).expect(200)).body as { items: Post[] };
    expect(grid.items.map((p) => p.id)).toEqual([original.id, reused.id]); // a de onde saiu o som à frente
    const recent = (await api().get(`/api/v1/sounds/${original.sound!.id}/tchekas?sort=recent`).set(auth(u.scid)).expect(200)).body as { items: Post[] };
    expect(recent.items.map((p) => p.id)).toEqual([reused.id, original.id]);

    // Só em tchekas; nunca um som e uma música ao mesmo tempo; ids inválidos recusados.
    await api().post('/api/v1/posts').set(auth(u.sbea)).send({ body: 'só texto', soundId: original.sound!.id }).expect(400);
    const v = await video(u.sbea);
    await api().post('/api/v1/posts').set(auth(u.sbea)).send({ body: 'x', mediaIds: [v], soundId: original.sound!.id, music: { id: catId, title: 'x', artist: 'y', url: 'https://cdn.freesound.org/previews/1/1_1-hq.mp3', license: 'by' } }).expect(400);
    await api().post('/api/v1/posts').set(auth(u.sbea)).send({ body: 'x', mediaIds: [v], soundId: 'cat:../x' }).expect(400);
    await api().post('/api/v1/posts').set(auth(u.sbea)).send({ body: 'x', mediaIds: [v], soundId: '0190d3c4-0000-7000-8000-000000000001' }).expect(404);
  }, 120_000);

  it('som do catálogo: página com a faixa, usar pelo id do som, usos e «Sons em alta»', async () => {
    const id = `cat:${catId}`;
    const before = (await api().get(`/api/v1/sounds/${encodeURIComponent(id)}`).set(auth(u.scid)).expect(200)).body;
    expect(before).toMatchObject({ kind: 'catalog', title: 'Marrabenta do som', artist: 'Artista Livre', canUse: true, uses: 1 });
    expect(before.music).toMatchObject({ id: catId, previewUrl: 'https://cdn.freesound.org/previews/1/1_1-hq.mp3' });
    const p = await tcheka(u.scid, { soundId: id });
    expect(p.sound?.id).toBe(id);
    expect(p.music).toMatchObject({ id: catId, title: 'Marrabenta do som' });
    expect((await api().get(`/api/v1/sounds/${encodeURIComponent(id)}`).set(auth(u.scid)).expect(200)).body.uses).toBe(2);

    const trending = (await api().get('/api/v1/sounds/trending').set(auth(u.scid)).expect(200)).body as { id: string; uses7d: number; uses: number }[];
    expect(trending.find((s) => s.id === original.sound!.id)).toMatchObject({ uses7d: 2, uses: 2 });
    expect(trending.find((s) => s.id === id)).toMatchObject({ uses7d: 2 });
    // Só números: nada de quem usou.
    expect(JSON.stringify(trending)).not.toContain(u.sbea.username);
  }, 120_000);

  it('visibilidade: bloqueados, contas privadas (não se usa o som de outra pessoa), menores e tchekas apagadas', async () => {
    // Bloqueio: o cid deixa de ver o som da ana (e o som na tcheka da bea fica sem ligação).
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.sana.id, u.scid.id]);
    await api().get(`/api/v1/sounds/${original.sound!.id}`).set(auth(u.scid)).expect(404);
    await api().get(`/api/v1/sounds/${original.sound!.id}/tchekas`).set(auth(u.scid)).expect(404);
    expect(((await api().get(`/api/v1/posts/${reused.id}`).set(auth(u.scid)).expect(200)).body as Post).sound).toBeNull();
    expect(((await api().get('/api/v1/sounds/trending').set(auth(u.scid)).expect(200)).body as { id: string }[]).map((s) => s.id)).not.toContain(original.sound!.id);
    const v = await video(u.scid);
    await api().post('/api/v1/posts').set(auth(u.scid)).send({ body: 'x', mediaIds: [v], soundId: original.sound!.id }).expect(404);
    await pool.query('DELETE FROM social.blocks WHERE blocker_id = $1 AND blocked_id = $2', [u.sana.id, u.scid.id]);

    // Conta privada: quem não segue não vê; quem segue vê mas não pode usar; o próprio pode.
    const priv = await tcheka(u.spri);
    expect(priv.sound?.kind).toBe('original');
    await api().get(`/api/v1/sounds/${priv.sound!.id}`).set(auth(u.scid)).expect(404);
    expect((await api().get(`/api/v1/sounds/${priv.sound!.id}`).set(auth(u.sbea)).expect(200)).body).toMatchObject({ canUse: false, unavailable: 'private' });
    { const vid = await video(u.sbea); await api().post('/api/v1/posts').set(auth(u.sbea)).send({ body: 'x', mediaIds: [vid], soundId: priv.sound!.id }).expect(403); }
    expect((await tcheka(u.spri, { soundId: priv.sound!.id })).sound?.id).toBe(priv.sound!.id);
    expect((await api().get('/api/v1/sounds/me/settings').set(auth(u.spri)).expect(200)).body).toMatchObject({ reuse: true, effective: false, private: true });

    // Menor: o som existe, mas os outros não o podem usar.
    const kid = await tcheka(u.smen);
    expect((await api().get(`/api/v1/sounds/${kid.sound!.id}`).set(auth(u.sbea)).expect(200)).body).toMatchObject({ canUse: false, unavailable: 'minor' });

    // Apagar a tcheka de onde o som saiu: o som deixa de existir para novos usos e a página sai.
    const gone = await tcheka(u.sana);
    await api().delete(`/api/v1/posts/${gone.id}`).set(auth(u.sana)).expect(204);
    await api().get(`/api/v1/sounds/${gone.sound!.id}`).set(auth(u.sbea)).expect(404);
    { const vid = await video(u.sbea); await api().post('/api/v1/posts').set(auth(u.sbea)).send({ body: 'x', mediaIds: [vid], soundId: gone.sound!.id }).expect(404); }

    // Na grelha não aparece o que eu denunciei.
    await api().post('/api/v1/reports').set(auth(u.scid)).send({ type: 'post', id: reused.id, reason: 'spam' });
    const grid = (await api().get(`/api/v1/sounds/${original.sound!.id}/tchekas`).set(auth(u.scid)).expect(200)).body as { items: Post[] };
    expect(grid.items.map((p) => p.id)).not.toContain(reused.id);
  }, 180_000);

  it('«Deixar usar o meu som» desligado: os outros não o usam; o próprio continua a poder', async () => {
    expect((await api().put('/api/v1/sounds/me/settings').set(auth(u.sana)).send({ reuse: false }).expect(200)).body).toMatchObject({ reuse: false, effective: false });
    expect((await api().get(`/api/v1/sounds/${original.sound!.id}`).set(auth(u.sbea)).expect(200)).body).toMatchObject({ canUse: false, unavailable: 'off' });
    { const vid = await video(u.sbea); await api().post('/api/v1/posts').set(auth(u.sbea)).send({ body: 'x', mediaIds: [vid], soundId: original.sound!.id }).expect(403); }
    expect(((await api().get('/api/v1/sounds/trending').set(auth(u.sbea)).expect(200)).body as { id: string }[]).map((s) => s.id)).not.toContain(original.sound!.id);
    expect((await tcheka(u.sana, { soundId: original.sound!.id })).sound?.id).toBe(original.sound!.id);
    // As tchekas que já o usavam continuam a tocar.
    expect(((await api().get(`/api/v1/posts/${reused.id}`).set(auth(u.sbea)).expect(200)).body as Post).music).toMatchObject({ kind: 'sound' });
    await api().put('/api/v1/sounds/me/settings').set(auth(u.sana)).send({ reuse: true }).expect(200);
  }, 120_000);

  it('denúncia «Este som tem música protegida»: fica escondido para novos usos; a equipa decide no backoffice', async () => {
    const s = await tcheka(u.sana);
    const id = s.sound!.id;
    await api().post(`/api/v1/sounds/${id}/report`).set(auth(u.sana)).send({ reason: 'copyright' }).expect(400); // o próprio
    await api().post(`/api/v1/sounds/${id}/report`).set(auth(u.sbea)).send({ reason: 'copyright', note: 'É uma música da rádio' }).expect(204);
    await api().post(`/api/v1/sounds/${id}/report`).set(auth(u.sbea)).send({ reason: 'copyright' }).expect(204); // outra vez: igual
    expect((await api().get(`/api/v1/sounds/${id}`).set(auth(u.scid)).expect(200)).body).toMatchObject({ canUse: false, unavailable: 'held' });
    { const vid = await video(u.scid); await api().post('/api/v1/posts').set(auth(u.scid)).send({ body: 'x', mediaIds: [vid], soundId: id }).expect(403); }
    await api().post(`/api/v1/sounds/cat:${catId}/report`).set(auth(u.sbea)).send({ reason: 'copyright' }).expect(400);

    // Backoffice: só a equipa.
    await api().get('/api/v1/admin/sounds').set(auth(u.sbea)).expect(401);
    const list = (await api().get('/api/v1/admin/sounds').set({ Authorization: `Bearer ${staff}` }).expect(200)).body as { id: string; open: number; status: string; reports: { note: string | null }[]; previewUrl: string }[];
    const item = list.find((x) => x.id === id)!;
    expect(item).toMatchObject({ open: 1, status: 'held' });
    expect(item.reports[0].note).toBe('É uma música da rádio');
    await api().post(`/api/v1/admin/sounds/${id}/decision`).set({ Authorization: `Bearer ${staff}` }).send({ action: 'dismiss', reason: 'Música própria' }).expect(204);
    expect((await api().get(`/api/v1/sounds/${id}`).set(auth(u.scid)).expect(200)).body.canUse).toBe(true);

    // Procedente: o som sai e deixa de tocar também nas tchekas que o usavam.
    const user = await tcheka(u.scid, { soundId: original.sound!.id });
    await api().post(`/api/v1/sounds/${original.sound!.id}/report`).set(auth(u.scid)).send({ reason: 'copyright' }).expect(204);
    await api().post(`/api/v1/admin/sounds/${original.sound!.id}/decision`).set({ Authorization: `Bearer ${staff}` }).send({ action: 'uphold', reason: 'Música protegida' }).expect(204);
    await api().get(`/api/v1/sounds/${original.sound!.id}`).set(auth(u.sbea)).expect(404);
    const after = (await api().get(`/api/v1/posts/${user.id}`).set(auth(u.sbea)).expect(200)).body as Post;
    expect(after.sound).toBeNull();
    expect(after.music).toBeNull();
    const audit = await pool.query(`SELECT action FROM audit.audit_log WHERE target = $1 ORDER BY created_at`, [`sound:${original.sound!.id}`]);
    expect(audit.rows.map((r) => r.action)).toContain('sound.remove');
    // Repor.
    await api().post(`/api/v1/admin/sounds/${original.sound!.id}/decision`).set({ Authorization: `Bearer ${staff}` }).send({ action: 'restore', reason: 'Engano' }).expect(204);
    expect(((await api().get(`/api/v1/posts/${user.id}`).set(auth(u.sbea)).expect(200)).body as Post).sound?.id).toBe(original.sound!.id);
  }, 180_000);

  it('exportação e eliminar a conta: os sons da pessoa saem e deixam de tocar', async () => {
    const mine = await tcheka(u.sdel);
    const used = await tcheka(u.sbea, { soundId: mine.sound!.id });
    await api().post(`/api/v1/sounds/${original.sound!.id}/report`).set(auth(u.sdel)).send({ reason: 'other' }).expect(204);
    const exp = (await api().get('/api/v1/me/export').set(auth(u.sdel)).expect(200)).body;
    expect(exp.soundReuse).toBe(true);
    expect(exp.sounds.map((s: { id: string }) => s.id)).toContain(mine.sound!.id);
    expect(exp.sounds.find((s: { id: string }) => s.id === mine.sound!.id).uses).toBe(2);
    expect(exp.soundReportsFiled[0]).toMatchObject({ soundId: original.sound!.id, reason: 'other' });
    expect(exp.soundsUsed.map((s: { soundId: string }) => s.soundId)).toContain(mine.sound!.id);

    await api().post('/api/v1/auth/delete-account').set(auth(u.sdel)).send({ confirmUsername: u.sdel.username, password: PASSWORD }).expect(204);
    await api().get(`/api/v1/sounds/${mine.sound!.id}`).set(auth(u.sbea)).expect(404);
    const after = (await api().get(`/api/v1/posts/${used.id}`).set(auth(u.sbea)).expect(200)).body as Post;
    expect(after.sound).toBeNull();
    expect(after.music).toBeNull();
    expect((await pool.query('SELECT count(*)::int AS n FROM content.sound_reports WHERE reporter_id = $1', [u.sdel.id])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT removed_at FROM content.sounds WHERE id = $1', [mine.sound!.id])).rows[0].removed_at).not.toBeNull();
  }, 120_000);
});
