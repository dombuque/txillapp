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
import { staffLogin } from '../staff/staff-test';
import { MUSIC_LICENSE_SHA256, MUSIC_LICENSE_VERSION } from './license';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const tmp = mkdtempSync(join(tmpdir(), 'txill-art-'));

/** Uma «música» de teste (um tom) com `seconds` segundos, em MP3 ou M4A. */
function makeSong(seconds: number, ext: 'mp3' | 'm4a', name: string) {
  const file = join(tmp, `${name}.${ext}`);
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, ...(ext === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '64k'] : ['-c:a', 'aac', '-b:a', '64k']), file], { stdio: 'ignore' });
  return readFileSync(file);
}
function makeVideo(seconds: number, name: string) {
  const file = join(tmp, `${name}.mp4`);
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', `testsrc=size=160x120:rate=10:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file], { stdio: 'ignore' });
  return readFileSync(file);
}
function makePng(name: string) {
  const file = join(tmp, `${name}.png`);
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', file], { stdio: 'ignore' });
  return readFileSync(file);
}

interface U { token: string; id: string; username: string }

describe('programa de artistas moçambicanos: pedido, faixas, licença, moderação, seletor, retirar e direitos (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  let staff = '';
  let staffId = '';
  const sauth = () => ({ Authorization: `Bearer ${staff}` });

  async function signup(name: string, birthDate = '1990-06-15'): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate, acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(a: U, bytes: Buffer, mime: string, purpose: 'public' | 'chat' | 'music' = 'public') {
    const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime, size: bytes.length, purpose }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
    return r.body.assetId as string;
  }
  async function video(a: U) {
    const id = await upload(a, makeVideo(2, `v${Math.random().toString(36).slice(2, 7)}`), 'video/mp4');
    await api().post(`/api/v1/media/${id}/complete`).set(auth(a)).expect(200);
    for (let i = 0; i < 60; i++) {
      const s = (await api().get(`/api/v1/media/${id}/status`).set(auth(a)).expect(200)).body as { status: string };
      if (s.status === 'ready') return id;
      if (s.status === 'deleted') throw new Error('vídeo recusado');
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('conversão demorou demais');
  }
  const apply = (a: U, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/artists/apply').set(auth(a)).send({
      stageName: 'Mano Txill', styles: ['marrabenta', 'afro-house'], links: [{ kind: 'instagram', url: 'https://instagram.com/manotxill' }, { kind: 'spotify', url: 'https://open.spotify.com/artist/x' }],
      rightsKind: 'self', rightsStatement: 'Sou o autor, compositor e intérprete das músicas que vou carregar e tenho todos os direitos.', ...extra,
    });
  const newTrack = async (a: U, title: string, extra: Record<string, unknown> = {}, code = 201) => {
    const audio = await upload(a, makeSong(40, 'mp3', `s${Math.random().toString(36).slice(2, 7)}`), 'audio/mpeg', 'music');
    return (await api().post('/api/v1/artists/tracks').set(auth(a)).send({ title, audioMediaId: audio, styles: ['marrabenta'], previewStartMs: 5000, previewMs: 20_000, explicit: false, licenseVersion: MUSIC_LICENSE_VERSION, acceptLicense: true, ...extra }).expect(code)).body;
  };
  const catalog = async (a: U, qs = '') => (await api().get(`/api/v1/music/local${qs}`).set(auth(a)).expect(200)).body as { id: string; trackId: string; title: string; artist: string; artistUsername: string; source: string; previewUrl: string; url: string; explicit: boolean }[];

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'm'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    u.art = await signup('art');
    u.fan = await signup('fan');
    u.kid = await signup('kid', '2011-03-01');
    u.rep = await signup('rep');
    u.gone = await signup('gone');
    const s = await staffLogin(app, 'mus');
    staff = s.token;
    staffId = s.userId;
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('pedido de artista: validações, fila da equipa, recusa com motivo, aprovação auditada e etiqueta «Artista» no perfil', async () => {
    const { art, fan } = u;
    // Sem pedido: a app recebe a licença, os estilos e os tipos de ligação.
    const me0 = (await api().get('/api/v1/artists/me').set(auth(art)).expect(200)).body;
    expect(me0.artist).toBeNull();
    expect(me0.license).toMatchObject({ version: MUSIC_LICENSE_VERSION, sha256: MUSIC_LICENSE_SHA256 });
    expect(me0.license.text).toMatch(/não exclusiva, gratuita/);
    expect(me0.styles).toContain('marrabenta');

    // Não aprovada: não carrega música.
    await api().post('/api/v1/media/uploads').set(auth(art)).send({ mime: 'audio/mpeg', size: 1000, purpose: 'music' }).expect(403);
    // Validações: estilo inventado, ligação http, editora sem nome.
    await apply(art, { styles: ['polka'] }).expect(400);
    await apply(art, { links: [{ kind: 'site', url: 'http://inseguro.example' }] }).expect(400);
    await apply(art, { rightsKind: 'label' }).expect(400);

    // Pede (com prova privada), aparece na fila da equipa; a equipa recusa com motivo.
    const proof = await upload(art, makePng('prova'), 'image/png', 'chat');
    const a1 = (await apply(art, { proofMediaId: proof }).expect(201)).body;
    expect(a1).toMatchObject({ status: 'pending', stageName: 'Mano Txill', hasProof: true });
    await api().get('/api/v1/admin/music/artists').expect(401);
    await api().get('/api/v1/admin/music/artists').set(auth(fan)).expect(401);
    let q = (await api().get('/api/v1/admin/music/artists').set(sauth()).expect(200)).body as { userId: string; proofUrl: string | null; links: unknown[] }[];
    const item = q.find((x) => x.userId === art.id)!;
    expect(item.proofUrl).toMatch(/^\/api\/v1\/chat\/media\//);
    expect(item.links).toHaveLength(2);
    await api().post(`/api/v1/admin/music/artists/${art.id}/decide`).set(sauth()).send({ action: 'reject' }).expect(400);
    await api().post(`/api/v1/admin/music/artists/${art.id}/decide`).set(sauth()).send({ action: 'reject', reason: 'Falta a ligação ao streaming' }).expect(204);
    expect((await api().get('/api/v1/artists/me').set(auth(art)).expect(200)).body.artist).toMatchObject({ status: 'rejected', reason: 'Falta a ligação ao streaming', hasProof: false });
    // A prova apagou-se depois da decisão.
    expect((await pool.query('SELECT status FROM content.media_assets WHERE id = $1', [proof])).rows[0].status).toBe('deleted');

    // Volta a pedir e é aprovada: etiqueta «Artista» no perfil (sem mexer no selo de verificado).
    await apply(art).expect(201);
    await api().post(`/api/v1/admin/music/artists/${art.id}/decide`).set(sauth()).send({ action: 'approve' }).expect(204);
    await api().post(`/api/v1/admin/music/artists/${art.id}/decide`).set(sauth()).send({ action: 'approve' }).expect(404); // já decidido
    await apply(art).expect(409);
    const prof = (await api().get(`/api/v1/users/${art.username}`).set(auth(fan)).expect(200)).body;
    expect(prof.artist).toMatchObject({ stageName: 'Mano Txill', styles: ['marrabenta', 'afro-house'] });
    expect(prof.verified).toBe(false);
    expect((await api().get(`/api/v1/users/${fan.username}`).set(auth(art)).expect(200)).body.artist).toBeNull();
    const audit = (await pool.query(`SELECT action, actor_id, metadata FROM audit.audit_log WHERE target = $1 AND action LIKE 'artist.%' ORDER BY created_at`, [`user:${art.id}`])).rows;
    expect(audit.map((r) => r.action)).toEqual(['artist.reject', 'artist.approve']);
    expect(audit[0].actor_id).toBe(staffId);
    // O aviso chega em nome do Txillapp.
    const notes = (await api().get('/api/v1/notifications').set(auth(art)).expect(200)).body.items as { kind: string; data: { what: string; decision: string }; actor: { username: string } }[];
    expect(notes.find((n) => n.kind === 'music_review' && n.data.decision === 'approved')).toMatchObject({ data: { what: 'artist' }, actor: { username: 'txillapp' } });
  });

  it('carregar: só áudio válido, licença aceite (versão, data e quem), trecho cortado, moderação e seletor', async () => {
    const { art, fan, kid } = u;
    // Tipos e limites do áudio.
    await api().post('/api/v1/media/uploads').set(auth(art)).send({ mime: 'audio/flac', size: 1000, purpose: 'music' }).expect(415);
    await api().post('/api/v1/media/uploads').set(auth(art)).send({ mime: 'audio/mpeg', size: 30 * 1024 * 1024, purpose: 'music' }).expect(413);
    // Conteúdo que não é o declarado: recusado logo no envio.
    const fake = await api().post('/api/v1/media/uploads').set(auth(art)).send({ mime: 'audio/mpeg', size: 100, purpose: 'music' }).expect(201);
    await api().put(fake.body.uploadUrl).set('Content-Type', 'audio/mpeg').send(Buffer.alloc(100, 7)).expect(415);

    // Sem aceitar a licença, ou com uma versão antiga: não publica.
    await newTrack(art, 'Sem licença', { acceptLicense: false }, 400);
    await newTrack(art, 'Licença velha', { licenseVersion: '2000-01-01' }, 409);
    // Música curta demais e trecho que passa do fim.
    const short = await upload(art, makeSong(8, 'mp3', 'curta'), 'audio/mpeg', 'music');
    await api().post('/api/v1/artists/tracks').set(auth(art)).send({ title: 'Curta', audioMediaId: short, styles: ['pandza'], previewStartMs: 0, previewMs: 10_000, licenseVersion: MUSIC_LICENSE_VERSION, acceptLicense: true }).expect(400);
    await newTrack(art, 'Trecho fora', { previewStartMs: 35_000, previewMs: 20_000 }, 400);
    // O áudio de outra pessoa não serve.
    await api().post('/api/v1/artists/tracks').set(auth(fan)).send({ title: 'x', audioMediaId: short, styles: ['pandza'], previewStartMs: 0, previewMs: 10_000, licenseVersion: MUSIC_LICENSE_VERSION, acceptLicense: true }).expect(403);

    // Com capa, M4A e explícita.
    const cover = await upload(art, makePng('capa'), 'image/png');
    const m4a = await upload(art, makeSong(30, 'm4a', 'm4a'), 'audio/mp4', 'music');
    const t2 = (await api().post('/api/v1/artists/tracks').set(auth(art)).send({ title: 'Noite em Maputo', audioMediaId: m4a, coverMediaId: cover, styles: ['amapiano'], previewStartMs: 0, previewMs: 15_000, explicit: true, licenseVersion: MUSIC_LICENSE_VERSION, acceptLicense: true }).expect(201)).body;
    expect(t2).toMatchObject({ status: 'pending', explicit: true, cover: `/api/v1/media/${cover}?w=480` });
    const t1 = (await newTrack(art, 'Xitende'));
    expect(t1).toMatchObject({ status: 'pending', title: 'Xitende', previewStartMs: 5000, previewMs: 20_000, licenseVersion: MUSIC_LICENSE_VERSION, uses: 0, people: 0 });
    expect(t1.durationMs).toBeGreaterThan(39_000);

    // O registo da licença: versão, resumo do texto, quem e quando.
    const lic = (await pool.query('SELECT user_id, version, text_sha256, accepted_at FROM content.artist_track_licenses WHERE track_id = $1', [t1.id])).rows;
    expect(lic).toHaveLength(1);
    expect(lic[0]).toMatchObject({ user_id: art.id, version: MUSIC_LICENSE_VERSION, text_sha256: MUSIC_LICENSE_SHA256 });
    expect(Date.now() - new Date(lic[0].accepted_at).getTime()).toBeLessThan(60_000);

    // O trecho foi cortado no servidor (~20 s, M4A) e o original nunca é servido ao público.
    const tr = (await pool.query('SELECT preview_media_id, audio_media_id FROM content.artist_tracks WHERE id = $1', [t1.id])).rows[0];
    const prev = (await pool.query('SELECT mime, duration_ms, purpose FROM content.media_assets WHERE id = $1', [tr.preview_media_id])).rows[0];
    expect(prev).toMatchObject({ mime: 'audio/mp4', purpose: 'music' });
    expect(prev.duration_ms).toBeGreaterThanOrEqual(19_000);
    await api().get(`/api/v1/media/${tr.audio_media_id}`).expect(404);
    await api().get(`/api/v1/media/${tr.preview_media_id}`).expect(404);

    // Por moderar: não está no seletor, e o trecho só toca com o URL da equipa.
    expect((await catalog(fan)).map((t) => t.trackId)).not.toContain(t1.id);
    const tq = (await api().get('/api/v1/admin/music/tracks').set(sauth()).expect(200)).body as { id: string; previewUrl: string; originalUrl: string; license: { version: string } }[];
    const queued = tq.find((x) => x.id === t1.id)!;
    expect(queued.license.version).toBe(MUSIC_LICENSE_VERSION);
    await api().get(queued.previewUrl).expect(200).expect('Content-Type', /audio\/mp4/);
    await api().get(queued.originalUrl).expect(200).expect('Content-Type', /audio\/mpeg/);
    await api().get(queued.previewUrl.replace('&r=1', '')).expect(403); // a assinatura da equipa não vale como pública

    await api().post(`/api/v1/admin/music/tracks/${t1.id}/decide`).set(sauth()).send({ action: 'reject' }).expect(400);
    await api().post(`/api/v1/admin/music/tracks/${t1.id}/decide`).set(sauth()).send({ action: 'approve' }).expect(204);
    await api().post(`/api/v1/admin/music/tracks/${t2.id}/decide`).set(sauth()).send({ action: 'approve' }).expect(204);
    expect((await pool.query(`SELECT action FROM audit.audit_log WHERE target = $1 AND action = 'artist_track.approve'`, [`user:${art.id}`])).rowCount).toBe(2);

    // No seletor: «Artistas de Moçambique», pela interface comum (source 'local', artistUsername).
    const list = await catalog(fan);
    const it1 = list.find((t) => t.trackId === t1.id)!;
    expect(it1).toMatchObject({ source: 'local', id: `local:${t1.id}`, title: 'Xitende', artist: 'Mano Txill', artistUsername: art.username, duration: 20, explicit: false });
    expect(it1.previewUrl).toBe(it1.url);
    await api().get(it1.previewUrl).expect(200).expect('Content-Type', /audio\/mp4/);
    expect(list.find((t) => t.trackId === t2.id)).toMatchObject({ explicit: true });
    // Filtros: estilo, texto e @ do artista. Menores não veem as explícitas.
    expect((await catalog(fan, `?style=amapiano&artist=${art.username}`)).map((t) => t.trackId)).toEqual([t2.id]);
    expect((await catalog(fan, `?q=xiten&artist=${art.username}`)).map((t) => t.trackId)).toEqual([t1.id]);
    expect((await catalog(fan, `?artist=${art.username}`)).length).toBe(2);
    expect((await catalog(kid)).map((t) => t.trackId)).not.toContain(t2.id);
    expect((await catalog(kid)).map((t) => t.trackId)).toContain(t1.id);
  }, 120_000);

  it('usos em mimos e tchekas (não em notas nem fotos), «♪ Título · Artista», números para o artista e retirar', async () => {
    const { art, fan, kid } = u;
    const [t1] = (await catalog(fan, `?q=xiten&artist=${art.username}`));
    const t2 = (await catalog(fan, `?style=amapiano&artist=${art.username}`))[0];

    // Num mimo.
    const photo = await upload(fan, makePng('mimo'), 'image/png');
    const story = (await api().post('/api/v1/stories').set(auth(fan)).send({ mediaId: photo, caption: 'bom dia', music: { source: 'local', id: t1.id, title: 'título falso' } }).expect(201)).body;
    expect(story.music).toMatchObject({ source: 'local', title: 'Xitende', artist: 'Mano Txill', artistUsername: art.username });
    expect(story.music.previewUrl).toMatch(/^\/api\/v1\/music\/local\/audio\//);
    // Numa tcheka (um só vídeo).
    const vid = await video(fan);
    const post = (await api().post('/api/v1/posts').set(auth(fan)).send({ body: 'a minha tcheka', mediaIds: [vid], music: { source: 'local', id: t1.id } }).expect(201)).body;
    expect(post.music).toMatchObject({ source: 'local', title: 'Xitende', artistUsername: art.username });
    // Outra vez a mesma pessoa, e outra pessoa (o artista, num mimo).
    const photo2 = await upload(fan, makePng('mimo2'), 'image/png');
    await api().post('/api/v1/stories').set(auth(fan)).send({ mediaId: photo2, caption: '', music: { source: 'local', id: t1.id } }).expect(201);
    const photo3 = await upload(art, makePng('mimo3'), 'image/png');
    await api().post('/api/v1/stories').set(auth(art)).send({ mediaId: photo3, caption: '', music: { source: 'local', id: t1.id } }).expect(201);

    // Fora da licença: publicação só com texto ou foto, e notas.
    await api().post('/api/v1/posts').set(auth(fan)).send({ body: 'só texto', music: { source: 'local', id: t1.id } }).expect(400);
    await api().put('/api/v1/notes/me').set(auth(fan)).send({ body: 'nota', music: { source: 'local', id: t1.id } }).expect(400);
    // Explícita: um menor não a usa.
    const kidPhoto = await upload(kid, makePng('kid'), 'image/png');
    await api().post('/api/v1/stories').set(auth(kid)).send({ mediaId: kidPhoto, caption: '', music: { source: 'local', id: t2.id } }).expect(403);
    // Faixa que não existe.
    await api().post('/api/v1/stories').set(auth(fan)).send({ mediaId: kidPhoto, caption: '', music: { source: 'local', id: 'local:00000000-0000-7000-8000-000000000000' } }).expect(400);

    // No Gerir: 4 usos, por 2 pessoas (só totais).
    let mine = (await api().get('/api/v1/artists/tracks').set(auth(art)).expect(200)).body as { id: string; uses: number; people: number; status: string }[];
    expect(mine.find((t) => t.id === t1.trackId)).toMatchObject({ uses: 4, people: 2, status: 'approved' });
    // Só o próprio vê as suas faixas.
    expect(((await api().get('/api/v1/artists/tracks').set(auth(fan)).expect(200)).body as unknown[]).length).toBe(0);
    await api().post(`/api/v1/artists/tracks/${t1.trackId}/withdraw`).set(auth(fan)).expect(404);

    // Retirar: sai do seletor e não dá para novos usos, mas o mimo e a tcheka antigos continuam a tocar.
    await api().post(`/api/v1/artists/tracks/${t1.trackId}/withdraw`).set(auth(art)).expect(200);
    expect((await catalog(fan)).map((t) => t.trackId)).not.toContain(t1.trackId);
    const photo4 = await upload(fan, makePng('mimo4'), 'image/png');
    await api().post('/api/v1/stories').set(auth(fan)).send({ mediaId: photo4, caption: '', music: { source: 'local', id: t1.id } }).expect(400);
    const again = (await api().get(`/api/v1/posts/${post.id}`).set(auth(fan)).expect(200)).body;
    expect(again.music).toMatchObject({ source: 'local', title: 'Xitende' });
    await api().get(again.music.previewUrl).expect(200);
    await api().get(story.music.previewUrl).expect(200);
    mine = (await api().get('/api/v1/artists/tracks').set(auth(art)).expect(200)).body;
    expect(mine.find((t) => t.id === t1.trackId)).toMatchObject({ status: 'withdrawn', uses: 4 });
    await api().post(`/api/v1/artists/tracks/${t1.trackId}/withdraw`).set(auth(art)).expect(404);
  }, 120_000);

  it('denúncia de direitos: esconde logo a faixa (também nos usos), a equipa decide e fica auditado', async () => {
    const { art, fan, rep } = u;
    const t3 = (await newTrack(art, 'Marrabenta da Mafalala'));
    await api().post(`/api/v1/admin/music/tracks/${t3.id}/decide`).set(sauth()).send({ action: 'approve' }).expect(204);
    const photo = await upload(fan, makePng('usa3'), 'image/png');
    const story = (await api().post('/api/v1/stories').set(auth(fan)).send({ mediaId: photo, caption: '', music: { source: 'local', id: `local:${t3.id}` } }).expect(201)).body;
    await api().get(story.music.previewUrl).expect(200);

    const claim = { claimantName: 'Editora Xigubo', contactEmail: 'direitos@xigubo.example', relation: 'label', details: 'Esta gravação é nossa, publicada em 2019 sem autorização.' };
    await api().post(`/api/v1/music/local/${t3.id}/report`).set(auth(rep)).send({ ...claim, contactEmail: 'não-é-email' }).expect(400);
    await api().post(`/api/v1/music/local/${t3.id}/report`).set(auth(art)).send(claim).expect(400); // o próprio retira no Gerir
    await api().post(`/api/v1/music/local/local:${t3.id}/report`).set(auth(rep)).send(claim).expect(201);
    await api().post(`/api/v1/music/local/${t3.id}/report`).set(auth(rep)).send(claim).expect(409);
    // Escondida: fora do seletor, sem novos usos e sem tocar nos usos antigos.
    expect((await catalog(fan)).map((t) => t.trackId)).not.toContain(t3.id);
    await api().get(story.music.previewUrl).expect(404);
    const mine = (await api().get('/api/v1/artists/tracks').set(auth(art)).expect(200)).body as { id: string; onHold: boolean }[];
    expect(mine.find((t) => t.id === t3.id)?.onHold).toBe(true);
    expect(((await api().get('/api/v1/admin/music/tracks?status=held').set(sauth()).expect(200)).body as { id: string }[]).map((t) => t.id)).toContain(t3.id);

    // A equipa não dá razão: volta a aparecer.
    let claims = (await api().get('/api/v1/admin/music/claims').set(sauth()).expect(200)).body as { id: string; track: { id: string }; reporter: string; contactEmail: string }[];
    let c = claims.find((x) => x.track.id === t3.id)!;
    expect(c).toMatchObject({ reporter: rep.username, contactEmail: 'direitos@xigubo.example' });
    await api().post(`/api/v1/admin/music/claims/${c.id}/decide`).set(sauth()).send({ action: 'dismiss' }).expect(400);
    await api().post(`/api/v1/admin/music/claims/${c.id}/decide`).set(sauth()).send({ action: 'dismiss', reason: 'O artista mostrou o contrato' }).expect(204);
    expect((await catalog(fan)).map((t) => t.trackId)).toContain(t3.id);
    await api().get(story.music.previewUrl).expect(200);

    // Nova denúncia e a equipa dá razão: a faixa sai de vez (também dos usos antigos) e o artista é avisado.
    await api().post(`/api/v1/music/local/${t3.id}/report`).set(auth(rep)).send(claim).expect(201);
    claims = (await api().get('/api/v1/admin/music/claims').set(sauth()).expect(200)).body;
    c = claims.find((x) => x.track.id === t3.id)!;
    await api().post(`/api/v1/admin/music/claims/${c.id}/decide`).set(sauth()).send({ action: 'uphold', reason: 'Gravação da editora' }).expect(204);
    expect((await catalog(fan)).map((t) => t.trackId)).not.toContain(t3.id);
    await api().get(story.music.previewUrl).expect(404);
    expect((await pool.query('SELECT status FROM content.artist_tracks WHERE id = $1', [t3.id])).rows[0].status).toBe('removed');
    const audit = (await pool.query(`SELECT action FROM audit.audit_log WHERE target = $1 AND action LIKE 'artist_claim.%' ORDER BY created_at`, [`user:${art.id}`])).rows.map((r) => r.action);
    expect(audit).toEqual(['artist_claim.dismiss', 'artist_claim.uphold']);
    const notes = (await api().get('/api/v1/notifications').set(auth(art)).expect(200)).body.items as { kind: string; data: { decision: string; title?: string } }[];
    expect(notes.find((n) => n.kind === 'music_review' && n.data.decision === 'removed')?.data.title).toBe('Marrabenta da Mafalala');
    // A equipa pode repor.
    await api().post(`/api/v1/admin/music/tracks/${t3.id}/decide`).set(sauth()).send({ action: 'restore' }).expect(204);
    expect((await catalog(fan)).map((t) => t.trackId)).toContain(t3.id);
    expect((await api().get('/api/v1/admin/music/summary').set(sauth()).expect(200)).body).toEqual(expect.objectContaining({ artists: expect.any(Number), tracks: expect.any(Number), claims: expect.any(Number) }));
  }, 120_000);

  it('exportar e apagar a conta: os dados do artista saem no ficheiro; ao apagar, as faixas deixam de estar disponíveis', async () => {
    const { gone, fan } = u;
    await apply(gone, { stageName: 'Gone Boy' }).expect(201);
    await api().post(`/api/v1/admin/music/artists/${gone.id}/decide`).set(sauth()).send({ action: 'approve' }).expect(204);
    const t = (await newTrack(gone, 'Adeus Beira'));
    await api().post(`/api/v1/admin/music/tracks/${t.id}/decide`).set(sauth()).send({ action: 'approve' }).expect(204);
    const photo = await upload(fan, makePng('usa-gone'), 'image/png');
    const story = (await api().post('/api/v1/stories').set(auth(fan)).send({ mediaId: photo, caption: '', music: { source: 'local', id: `local:${t.id}` } }).expect(201)).body;

    const exp = (await api().get('/api/v1/me/export').set(auth(gone)).expect(200)).body;
    expect(exp.artist).toMatchObject({ stageName: 'Gone Boy', status: 'approved' });
    expect(exp.artistTracks).toEqual([expect.objectContaining({ title: 'Adeus Beira', uses: 1, people: 1 })]);
    expect(exp.musicLicenseAcceptances).toEqual([expect.objectContaining({ title: 'Adeus Beira', version: MUSIC_LICENSE_VERSION, textSha256: MUSIC_LICENSE_SHA256 })]);
    const fanExp = (await api().get('/api/v1/me/export').set(auth(fan)).expect(200)).body;
    expect(fanExp.artistTracksUsed.map((x: { title: string }) => x.title)).toContain('Adeus Beira');
    const repExp = (await api().get('/api/v1/me/export').set(auth(u.rep)).expect(200)).body;
    expect(repExp.copyrightReportsFiled.length).toBe(2);

    await api().post('/api/v1/auth/delete-account').set(auth(gone)).send({ confirmUsername: gone.username, password: PASSWORD }).expect(204);
    expect((await catalog(fan)).map((x) => x.trackId)).not.toContain(t.id);
    await api().get(story.music.previewUrl).expect(404);
    expect((await pool.query('SELECT status FROM content.artist_tracks WHERE id = $1', [t.id])).rows[0].status).toBe('removed');
    expect((await pool.query('SELECT 1 FROM content.artist_profiles WHERE user_id = $1', [gone.id])).rowCount).toBe(0);
    // Fica a prova da licença (quem aceitou, que versão e quando), ligada à conta anonimizada.
    expect((await pool.query('SELECT 1 FROM content.artist_track_licenses WHERE track_id = $1', [t.id])).rowCount).toBe(1);
    // Os ficheiros do artista vão para apagar.
    const media = (await pool.query(`SELECT status FROM content.media_assets WHERE owner_id = $1 AND purpose = 'music'`, [gone.id])).rows;
    expect(media.every((m) => m.status === 'deleted')).toBe(true);
  }, 120_000);
});
