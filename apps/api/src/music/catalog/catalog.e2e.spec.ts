import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../../config';
import { migrate } from '../../db/migrate';
import { createApp } from '../../main';
import { staffLogin } from '../../staff/staff-test';
import { MusicCatalogService } from './catalog.service';
import type { CatalogTrack, LocalMusicSource } from './track';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
interface U { token: string; id: string; username: string }

// ---------------------------------------------------------------- fontes simuladas (nada sai da máquina)

const BY3 = 'http://creativecommons.org/licenses/by/3.0/';
const ccm = (id: number, name: string, o: { lic?: string; ps?: string; scores?: number; file?: boolean; tags?: string } = {}) => ({
  upload_id: id,
  upload_name: name,
  user_name: 'grapes',
  user_real_name: 'Grapes',
  license_url: o.lic ?? BY3,
  file_page_url: `https://ccmixter.org/files/grapes/${id}`,
  upload_num_scores: o.scores ?? 120,
  upload_extra: { usertags: o.tags ?? 'hip_hop,instrumental', nsfw: false, num_reviews: 12 },
  files: o.file === false ? [] : [{ download_url: `https://ccmixter.org/content/grapes/${id}.mp3`, file_format_info: { 'media-type': 'audio', 'default-ext': 'mp3', ps: o.ps ?? '3:00' } }],
});
const CCM_HIPHOP = [
  ccm(1001, 'Beat do Bairro'),
  ccm(1002, 'Só não comercial', { lic: 'http://creativecommons.org/licenses/by-nc/3.0/' }),
  ccm(1003, 'Partilha igual', { lic: 'http://creativecommons.org/licenses/by-sa/3.0/' }),
  ccm(1004, 'Sem derivados', { lic: 'http://creativecommons.org/licenses/by-nd/3.0/' }),
  ccm(1005, 'Curtíssima', { ps: '0:20' }),
  ccm(1006, 'Drum Loop 90bpm', { ps: '2:00' }),
  ccm(1007, 'Ninguém gostou', { scores: 2 }),
  ccm(1008, 'Sem pré-visualização', { file: false }),
  ccm(1009, 'Longuíssima', { ps: '12:30' }),
  ccm(1010, 'Rap Vocals (acappella)'),
];
const CCM_CHILL_CC0 = [ccm(2001, 'Tarde na Costa do Sol', { lic: 'http://creativecommons.org/publicdomain/zero/1.0/', tags: 'lofi,chill', ps: '2:30' })];

const ARCHIVE_SEARCH = {
  response: {
    docs: [
      { identifier: 'netlabel-gospel', title: 'Louvor Livre', creator: 'Coro Aberto', downloads: 5000, avg_rating: 4.5, num_reviews: 4, licenseurl: BY3 },
      { identifier: 'nd-item', title: 'Não deixa', downloads: 90000, licenseurl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/' },
      { identifier: 'pouca-gente', title: 'Poucos downloads', downloads: 50, licenseurl: BY3 },
    ],
  },
};
const ARCHIVE_FILES: Record<string, unknown> = {
  'netlabel-gospel': { result: [
    { name: 'aleluia.mp3', format: 'VBR MP3', title: 'Aleluia Livre', artist: 'Coro Aberto', length: '200.5' },
    { name: 'aleluia_64kb.mp3', format: '64Kbps MP3', length: '200.5' },
    { name: 'intro.mp3', format: 'VBR MP3', title: 'Intro', length: '12' },
    { name: 'capa.jpg', format: 'JPEG' },
  ] },
  'pouca-gente': { result: [{ name: 'faixa.mp3', format: 'VBR MP3', title: 'Faixa', length: '180' }] },
};

const JAMENDO_AFRO = {
  headers: { status: 'success' },
  results: [
    { id: '555', name: 'Maputo Sunset', artist_name: 'Afro Livre', duration: 210, audio: 'https://prod-1.storage.jamendo.com/?trackid=555&format=mp31', image: 'https://usercontent.jamendo.com/?type=album&id=1', shareurl: 'https://www.jamendo.com/track/555', license_ccurl: BY3, stats: { rate_listened_total: 50_000, rate_downloads_total: 3000, favorited: 200 } },
    { id: '556', name: 'Não comercial', artist_name: 'X', duration: 200, audio: 'https://prod-1.storage.jamendo.com/?trackid=556&format=mp31', license_ccurl: 'http://creativecommons.org/licenses/by-nc-sa/3.0/', stats: { rate_listened_total: 90_000 } },
    { id: '557', name: 'Pouco ouvida', artist_name: 'Y', duration: 200, audio: 'https://prod-1.storage.jamendo.com/?trackid=557&format=mp31', license_ccurl: BY3, stats: { rate_listened_total: 40 } },
  ],
};
const FREESOUND = {
  results: [
    { id: 777, name: 'Applause crowd.wav', username: 'fsuser', duration: 6.2, license: 'http://creativecommons.org/publicdomain/zero/1.0/', url: 'https://freesound.org/s/777/', previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/7/777-hq.mp3' }, num_downloads: 20_000, avg_rating: 4.4, num_ratings: 50 },
    { id: 778, name: 'Mal avaliado', username: 'fsuser', duration: 3, license: 'http://creativecommons.org/publicdomain/zero/1.0/', previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/7/778-hq.mp3' }, num_downloads: 20_000, avg_rating: 2, num_ratings: 50 },
    { id: 779, name: 'NC', username: 'fsuser', duration: 3, license: 'http://creativecommons.org/licenses/by-nc/3.0/', previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/7/779-hq.mp3' }, num_downloads: 20_000, avg_rating: 4.5, num_ratings: 50 },
  ],
};

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

describe('música: catálogo curado, Em alta, «Não gosto desta», fonte local e backoffice (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let catalog: MusicCatalogService;
  let fetchSpy: jest.SpyInstance;
  const blocked: string[] = [];
  const seen: { url: string; auth?: string }[] = [];
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const ids = (list: { id: string }[]) => list.map((t) => t.id);
  const home = async (x: U) => (await api().get('/api/v1/music/home').set(auth(x)).expect(200)).body;
  const track = async (id: string) => (await pool.query('SELECT track FROM content.music_catalog WHERE id = $1', [id])).rows[0]?.track as CatalogTrack | undefined;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', JAMENDO_CLIENT_ID: 'jamendo-teste', FREESOUND_TOKEN: 'freesound-token-teste' }));
    await app.init();
    catalog = app.get(MusicCatalogService);
    // Começa de um catálogo limpo (a base de testes é partilhada).
    await pool.query("DELETE FROM content.music_catalog WHERE source IN ('ccmixter', 'archive', 'jamendo', 'freesound')");
    await pool.query('DELETE FROM content.music_flags');
    await pool.query('DELETE FROM content.music_dislikes');
    await pool.query("UPDATE content.posts SET music = NULL WHERE music->>'source' IN ('ccmixter', 'archive', 'jamendo', 'freesound', 'local')");
    for (const n of ['mca', 'mcb']) u[n] = await signup(n);

    const real = global.fetch;
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const host = new URL(url).hostname;
      if (host === '127.0.0.1' || host === 'localhost') return real(input, init);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url, auth: headers.Authorization });
      const p = new URL(url).searchParams;
      if (host === 'ccmixter.org') {
        const tags = p.get('tags') ?? '';
        if (p.get('lic') === 'by' && tags.includes('hip_hop')) return json(CCM_HIPHOP);
        if (p.get('lic') === 'pd' && tags.includes('lofi')) return json(CCM_CHILL_CC0);
        return json([]);
      }
      if (host === 'archive.org' && url.includes('/advancedsearch.php')) return json((p.get('q') ?? '').includes('"gospel"') ? ARCHIVE_SEARCH : { response: { docs: [] } });
      if (host === 'archive.org' && url.includes('/metadata/')) {
        const id = decodeURIComponent(url.split('/metadata/')[1].split('/')[0]);
        return ARCHIVE_FILES[id] ? json(ARCHIVE_FILES[id]) : json({ result: [] });
      }
      if (host === 'api.jamendo.com') {
        if (p.get('client_id') !== 'jamendo-teste') return json({ headers: { status: 'failed', error_message: 'client_id' } });
        const t = p.get('fuzzytags') ?? '';
        return json(t.includes('afrobeat') || t.includes('dance') ? JAMENDO_AFRO : { headers: { status: 'success' }, results: [] });
      }
      if (host === 'freesound.org') return json(FREESOUND);
      blocked.push(url);
      throw new Error(`pedido real bloqueado no teste: ${url}`);
    });
  }, 60_000);

  afterAll(async () => {
    fetchSpy.mockRestore();
    catalog.registerLocalSource(null);
    await app.close();
    await pool.end();
  });

  it('a tarefa periódica faz a curadoria: só licenças que servem, com sinais de qualidade, duração certa e pré-visualização', async () => {
    const r = await catalog.refresh();
    expect(r.sources).toMatchObject({ ccmixter: { ok: true }, archive: { ok: true }, jamendo: { ok: true }, freesound: { ok: true } });
    const all = (await pool.query("SELECT id, kind, styles, quality FROM content.music_catalog WHERE source IN ('ccmixter', 'archive', 'jamendo', 'freesound')")).rows as { id: string; kind: string; styles: string[] }[];
    const got = ids(all).sort();
    const gospel = all.find((x) => x.id.startsWith('archive:'))!;
    expect(got).toEqual(['ccmixter:1001', 'ccmixter:2001', gospel.id, 'freesound:777', 'jamendo:555'].sort());
    // fora: NC, SA, ND, curtíssima, loop, poucas recomendações, sem pré-visualização, longuíssima, a cappella (ccMixter);
    // ND, poucos downloads, intro de 12 s (Archive); NC e pouco ouvida (Jamendo); mal avaliado e NC (Freesound).
    expect(all.find((x) => x.id === 'freesound:777')).toMatchObject({ kind: 'sound', styles: [] });
    expect(all.find((x) => x.id === 'jamendo:555')!.styles.sort()).toEqual(['afrobeats', 'festa']);
    expect(gospel.styles).toEqual(['gospel']);
    expect(await track(gospel.id)).toMatchObject({ title: 'Aleluia Livre', artist: 'Coro Aberto', duration: 201, license: 'by', source: 'archive', previewUrl: 'https://archive.org/download/netlabel-gospel/aleluia.mp3' });
    expect(await track('ccmixter:2001')).toMatchObject({ license: 'cc0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', duration: 150, styles: ['chill'] });
    expect(await track('ccmixter:1001')).toMatchObject({ licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', landing: 'https://ccmixter.org/files/grapes/1001', previewUrl: 'https://ccmixter.org/content/grapes/1001.mp3' });
    // As chaves vão para as fontes certas (e só para elas).
    expect(seen.find((x) => x.url.startsWith('https://freesound.org/'))!.auth).toBe('Token freesound-token-teste');
    expect(seen.filter((x) => x.url.includes('freesound-token-teste') || (x.url.includes('jamendo-teste') && !x.url.startsWith('https://api.jamendo.com/')))).toEqual([]);
    // Correr outra vez não duplica.
    const again = await catalog.refresh();
    expect(again).toMatchObject({ added: 0, updated: 5 });
  });

  it('o seletor: estilos com faixas, «Em alta» (só música), «Sons» à parte, sem «Artistas de Moçambique» enquanto não houver fonte local', async () => {
    const h = await home(u.mca);
    expect(h.styles.map((s: { id: string }) => s.id)).toEqual(['afrobeats', 'hiphop', 'gospel', 'chill', 'festa']);
    expect(h.styles[0]).toMatchObject({ label: 'Afrobeats', kind: 'estilo', count: 1 });
    expect(h.local).toBeNull();
    expect(h.sounds).toBe(true);
    expect(ids(h.trending)).not.toContain('freesound:777');
    expect(h.trending[0]).toHaveProperty('uses', 0);
    expect(h.trending.find((t: { id: string }) => t.id === 'jamendo:555')).toMatchObject({ url: 'https://prod-1.storage.jamendo.com/?trackid=555&format=mp31', previewUrl: 'https://prod-1.storage.jamendo.com/?trackid=555&format=mp31', durationMs: 210_000, duration: 210, license: 'by', source: 'jamendo' });

    expect(ids((await api().get('/api/v1/music/styles/hiphop').set(auth(u.mca)).expect(200)).body)).toEqual(['ccmixter:1001']);
    await api().get('/api/v1/music/styles/kuduro-nao-existe').set(auth(u.mca)).expect(404);
    expect(ids((await api().get('/api/v1/music/sounds').set(auth(u.mca)).expect(200)).body)).toEqual(['freesound:777']);
    expect((await api().get('/api/v1/music/local').set(auth(u.mca)).expect(200)).body).toEqual([]);
    await api().get('/api/v1/music/home').expect(401);
  });

  it('pesquisa no catálogo: título, artista e estilo (também as pastilhas antigas: afro, dance)', async () => {
    const q = async (s: string) => ids((await api().get(`/api/v1/music/search?q=${encodeURIComponent(s)}`).set(auth(u.mca)).expect(200)).body);
    expect(await q('beat do')).toEqual(['ccmixter:1001']);
    expect(await q('afro')).toContain('jamendo:555');
    expect(await q('dance')).toEqual(['jamendo:555']);
    expect(await q('applause')).toEqual(['freesound:777']);
    expect(await q('lo-fi')).toEqual(['ccmixter:2001']);
    expect(await q('nada disto existe')).toEqual([]);
    await api().get('/api/v1/music/search?q=a').set(auth(u.mca)).expect(400);
  });

  it('usar uma faixa: o servidor guarda a versão do catálogo; NC/SA continuam recusadas', async () => {
    const forged = { id: 'ccmixter:1001', title: 'Título inventado', artist: 'Outra pessoa', url: 'https://cdn.freesound.org/previews/9/9.mp3', landing: null, license: 'cc0', licenseUrl: null, durationMs: 1000, cover: null };
    const post = (await api().post('/api/v1/posts').set(auth(u.mcb)).send({ body: 'beat', music: forged }).expect(201)).body;
    expect(post.music).toMatchObject({ id: 'ccmixter:1001', title: 'Beat do Bairro', artist: 'Grapes', url: 'https://ccmixter.org/content/grapes/1001.mp3', license: 'by', durationMs: 180_000, source: 'ccmixter' });
    const bySa = { ...forged, id: 'antiga-1', license: 'by-sa' };
    await api().post('/api/v1/posts').set(auth(u.mcb)).send({ body: 'x', music: bySa }).expect(400);
    await api().post('/api/v1/posts').set(auth(u.mcb)).send({ body: 'x', music: { ...forged, id: 'antiga-2', license: 'txillapp' } }).expect(400); // só a fonte local
    await api().post('/api/v1/posts').set(auth(u.mcb)).send({ body: 'x', music: { ...forged, id: 'antiga-3', url: 'https://evil.example.com/a.mp3' } }).expect(400);
  });

  it('«Em alta no Txillapp»: conta os usos dos últimos 7 dias em mimos e tchekas; só números, nada de quem usou', async () => {
    const cat = async (id: string) => ({ ...(await track(id))!, url: (await track(id))!.previewUrl, durationMs: 1, landing: null, licenseUrl: null });
    const chill = await cat('ccmixter:2001');
    const afro = await cat('jamendo:555');
    for (let i = 0; i < 2; i++) await api().post('/api/v1/posts').set(auth(u.mcb)).send({ body: `chill ${i}`, music: chill }).expect(201);
    await api().post('/api/v1/posts').set(auth(u.mca)).send({ body: 'afro', music: afro }).expect(201);
    // Usos antigos (há 10 dias) não contam para a semana: o post do teste anterior com o 1001 e mais três.
    for (let i = 0; i < 3; i++) await api().post('/api/v1/posts').set(auth(u.mca)).send({ body: `antigo ${i}`, music: await cat('ccmixter:1001') }).expect(201);
    await pool.query(`UPDATE content.posts SET created_at = now() - interval '10 days' WHERE music->>'id' = 'ccmixter:1001'`);
    catalog.invalidate();
    const h = await home(u.mca);
    expect(ids(h.trending).slice(0, 2)).toEqual(['ccmixter:2001', 'jamendo:555']);
    expect(h.trending[0].uses).toBe(2);
    expect(h.trending[1].uses).toBe(1);
    expect(h.trending.find((t: { id: string }) => t.id === 'ccmixter:1001').uses).toBe(0);
    const raw = JSON.stringify(h.trending);
    expect(raw).not.toContain(u.mcb.username);
    expect(raw).not.toContain(u.mcb.id);
    expect(ids(h.recent)).toContain('jamendo:555'); // as que eu (mca) usei
    // As versões antigas da app (/music/suggested) também recebem o catálogo.
    const old = (await api().get('/api/v1/music/suggested').set(auth(u.mca)).expect(200)).body;
    expect(ids(old.trending).slice(0, 2)).toEqual(['ccmixter:2001', 'jamendo:555']);
  });

  it('«Não gosto desta»: sai logo para mim; com muitas pessoas (limiar) desce para todos', async () => {
    await api().put('/api/v1/music/dislikes/jamendo:555').set(auth(u.mca)).expect(200, { disliked: true });
    const mine = await home(u.mca);
    expect(ids(mine.trending)).not.toContain('jamendo:555');
    expect(mine.styles.map((s: { id: string }) => s.id)).not.toContain('afrobeats');
    expect(ids((await api().get('/api/v1/music/search?q=maputo').set(auth(u.mca)).expect(200)).body)).toEqual([]);
    expect(ids((await home(u.mcb)).trending)).toContain('jamendo:555'); // para os outros continua
    await api().delete('/api/v1/music/dislikes/jamendo:555').set(auth(u.mca)).expect(200, { disliked: false });
    expect(ids((await home(u.mca)).trending)).toContain('jamendo:555');
    await api().put(`/api/v1/music/dislikes/${encodeURIComponent('<script>')}`).set(auth(u.mca)).expect(400);

    // O ccmixter:2001 foi usado 2 vezes; com 9 pessoas a marcar ainda não desce, com 10 (o limiar) desce para todos.
    const fillers: string[] = [];
    for (let i = 0; i < 10; i++) {
      const name = `mcf${i}${run}`.slice(0, 28);
      fillers.push((await pool.query(`INSERT INTO identity.users (id, email, username, display_name) VALUES (gen_random_uuid(), $1, $2, 'Enchimento') RETURNING id`, [`${name}@example.com`, name])).rows[0].id);
    }
    for (const id of fillers.slice(0, 9)) await pool.query(`INSERT INTO content.music_dislikes (user_id, track_id) VALUES ($1, 'ccmixter:2001')`, [id]);
    catalog.invalidate();
    expect(ids((await home(u.mcb)).trending)[0]).toBe('ccmixter:2001');
    await pool.query(`INSERT INTO content.music_dislikes (user_id, track_id) VALUES ($1, 'ccmixter:2001')`, [fillers[9]]);
    catalog.invalidate();
    const after = await home(u.mcb);
    expect(ids(after.trending)).not.toContain('ccmixter:2001');
    // Continua no estilo (quem procura acha), mas no fim.
    expect(ids((await api().get('/api/v1/music/styles/chill').set(auth(u.mcb)).expect(200)).body)).toEqual(['ccmixter:2001']);
  });

  it('backoffice: mais usadas, mais rejeitadas com o limiar, esconder e destacar ficam na auditoria; só quem gere o catálogo', async () => {
    const mod = await staffLogin(app, 'musmod', ['moderacao']);
    const sup = await staffLogin(app, 'mussup', ['suporte']);
    await api().get('/api/v1/admin/music').set(auth(sup)).expect(403);
    await api().get('/api/v1/admin/music').set(auth(u.mca)).expect(401);

    const rej = (await api().get('/api/v1/admin/music?sort=dislikes').set(auth(mod)).expect(200)).body;
    expect(rej.threshold.minPeople).toBe(10);
    expect(rej.threshold.rule).toContain('10 pessoas');
    expect(rej.items[0]).toMatchObject({ id: 'ccmixter:2001', dislikes: 10, uses7d: 2, uses30d: 2, downranked: true, status: 'active' });
    expect(rej.sources.find((s: { id: string }) => s.id === 'local')).toMatchObject({ enabled: false });
    expect(rej.sources.find((s: { id: string }) => s.id === 'jamendo')).toMatchObject({ enabled: true });
    const top = (await api().get('/api/v1/admin/music?sort=uses').set(auth(mod)).expect(200)).body;
    expect(top.items[0].id).toBe('ccmixter:2001');
    expect(ids((await api().get('/api/v1/admin/music?status=downranked').set(auth(mod)).expect(200)).body.items)).toEqual(['ccmixter:2001']);
    expect(ids((await api().get('/api/v1/admin/music?style=gospel').set(auth(mod)).expect(200)).body.items)).toHaveLength(1);
    expect(JSON.stringify(rej)).not.toContain(u.mcb.id); // só contagens

    // Esconder: sai do seletor e deixa de se poder usar.
    await api().post('/api/v1/admin/music/status').set(auth(mod)).send({ id: 'jamendo:555', status: 'hidden', reason: 'x' }).expect(400); // motivo curto
    await api().post('/api/v1/admin/music/status').set(auth(mod)).send({ id: 'ccmixter:999999', status: 'hidden', reason: 'não existe' }).expect(404);
    await api().post('/api/v1/admin/music/status').set(auth(sup)).send({ id: 'jamendo:555', status: 'hidden', reason: 'sem permissão' }).expect(403);
    await api().post('/api/v1/admin/music/status').set(auth(mod)).send({ id: 'jamendo:555', status: 'hidden', reason: 'Qualidade má' }).expect(204);
    expect(ids((await home(u.mcb)).trending)).not.toContain('jamendo:555');
    const afro = { ...(await track('jamendo:555'))!, url: 'https://prod-1.storage.jamendo.com/?trackid=555&format=mp31', durationMs: 1000, landing: null, licenseUrl: null };
    await api().post('/api/v1/posts').set(auth(u.mcb)).send({ body: 'x', music: afro }).expect(400);
    expect((await api().get('/api/v1/admin/music?status=hidden').set(auth(mod)).expect(200)).body.items[0]).toMatchObject({ id: 'jamendo:555', status: 'hidden', statusReason: 'Qualidade má' });

    // Destacar: vai para o topo de «Em alta».
    await api().post('/api/v1/admin/music/status').set(auth(mod)).send({ id: 'ccmixter:1001', status: 'featured', reason: 'Escolha da equipa' }).expect(204);
    const h = await home(u.mcb);
    expect(h.trending[0]).toMatchObject({ id: 'ccmixter:1001', featured: true });
    await api().post('/api/v1/admin/music/status').set(auth(mod)).send({ id: 'jamendo:555', status: 'active', reason: 'Afinal está boa' }).expect(204);
    expect(ids((await home(u.mcb)).trending)).toContain('jamendo:555');

    const log = (await pool.query(`SELECT action, target, metadata, actor_id FROM audit.audit_log WHERE target LIKE 'music:%' AND actor_id = $1 ORDER BY id`, [mod.userId])).rows;
    expect(log.map((r) => r.action)).toEqual(['music.hide', 'music.feature', 'music.restore']);
    expect(log[0]).toMatchObject({ target: 'music:jamendo:555', metadata: { title: 'Maputo Sunset', reason: 'Qualidade má', from: 'active', to: 'hidden' } });

    const ref = (await api().post('/api/v1/admin/music/refresh').set(auth(mod)).send({}).expect(200)).body;
    expect(ref).toMatchObject({ added: 0, updated: 5 });
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit.audit_log WHERE action = 'music.refresh' AND actor_id = $1`, [mod.userId])).rows[0].n).toBe(1);
  });

  it('fonte local (artistas de Moçambique): a secção aparece quando a fonte existe; as faixas usam-se pela versão do servidor', async () => {
    const mano: CatalogTrack = { id: 'local:0190aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee', title: 'Marrabenta do Bairro', artist: 'Mano Txill', duration: 185, previewUrl: 'https://media.txillapp.com/music/mano.m4a', cover: null, source: 'local', license: 'txillapp', licenseUrl: null, landing: null, styles: ['marrabenta'], kind: 'music', artistUsername: 'mano_txill' };
    const local: LocalMusicSource = {
      list: async ({ style, q }) => [mano].filter((t) => (!style || t.styles.includes(style)) && (!q || `${t.title} ${t.artist}`.toLowerCase().includes(q.toLowerCase()))),
      get: async (id) => (id === mano.id ? mano : null),
    };
    catalog.registerLocalSource(local);
    const h = await home(u.mca);
    expect(ids(h.local)).toEqual([mano.id]);
    expect(h.local[0]).toMatchObject({ artistUsername: 'mano_txill', license: 'txillapp', url: mano.previewUrl });
    expect(h.styles.map((s: { id: string }) => s.id)).toContain('marrabenta');
    expect(ids((await api().get('/api/v1/music/local?style=marrabenta').set(auth(u.mca)).expect(200)).body)).toEqual([mano.id]);
    expect(ids((await api().get('/api/v1/music/search?q=mano').set(auth(u.mca)).expect(200)).body)).toEqual([mano.id]);

    const sent = { id: mano.id, title: 'Outro título', artist: 'X', url: 'https://evil.example.com/a.mp3', landing: null, license: 'txillapp', licenseUrl: null, durationMs: 1000, cover: null, source: 'local' };
    const post = (await api().post('/api/v1/posts').set(auth(u.mca)).send({ body: 'marrabenta', music: sent }).expect(201)).body;
    expect(post.music).toMatchObject({ id: mano.id, title: 'Marrabenta do Bairro', url: mano.previewUrl, license: 'txillapp', artistUsername: 'mano_txill', source: 'local' });
    await api().post('/api/v1/posts').set(auth(u.mca)).send({ body: 'x', music: { ...sent, id: 'local:nao-existe' } }).expect(400);
    await api().put('/api/v1/music/favorites').set(auth(u.mca)).send(sent).expect(200);
    expect((await api().get('/api/v1/music/favorites').set(auth(u.mca)).expect(200)).body[0]).toMatchObject({ id: mano.id, url: mano.previewUrl });

    // O backoffice também esconde faixas da fonte local.
    const mod = await staffLogin(app, 'musmod2', ['moderacao']);
    expect((await api().get('/api/v1/admin/music?q=mano').set(auth(mod)).expect(200)).body.items[0]).toMatchObject({ id: mano.id, source: 'local' });
    await api().post('/api/v1/admin/music/status').set(auth(mod)).send({ id: mano.id, status: 'hidden', reason: 'Pedido do artista' }).expect(204);
    expect((await home(u.mca)).local).toBeNull();

    catalog.registerLocalSource(null);
    expect((await home(u.mca)).local).toBeNull();
    await api().post('/api/v1/posts').set(auth(u.mca)).send({ body: 'x', music: sent }).expect(400);
  });

  it('nenhum pedido real às fontes externas', () => {
    expect(blocked).toEqual([]);
  });
});
