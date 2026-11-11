import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { uuidv7 } from '../common/uuid7';
import { AnalysesService } from './analyses.service';
import { normalizeSearchTerm, SearchStatsService } from './search-stats.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

/**
 * Análises do backoffice: permissões, números certos com dados conhecidos e o limiar de k (20) a esconder segmentos pequenos.
 * Os dados ficam num país de teste próprio ("ZZ") para não se misturarem com os dos outros testes.
 */
describe('Análises do backoffice (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const tok: Record<string, string> = {};
  let growthId = '';
  const ids: string[] = [];
  const small: string[] = [];
  let optout = '';
  const C = 'ZZ';

  /** Um instante: `day` dias a contar de hoje (em Maputo), às `hour` horas de Maputo. */
  const at = (day: number, hour = 12) => `(((now() AT TIME ZONE 'Africa/Maputo')::date + (${day})) + time '${String(hour).padStart(2, '0')}:00') AT TIME ZONE 'Africa/Maputo'`;

  async function user(i: string, createdDay: number, extra: { country?: string; city?: string | null; birth?: string; share?: boolean } = {}) {
    const name = `an${i}${run}`.slice(0, 28);
    const r = await pool.query(
      `INSERT INTO identity.users (id, email, username, display_name, created_at, country, city, birth_date, share_analytics)
       VALUES ($8, $1, $2, $7, ${at(createdDay)}, $3, $4, $5, $6) RETURNING id`,
      [`${name}@example.com`, name, extra.country ?? C, extra.city ?? null, extra.birth ?? '1995-01-01', extra.share ?? true, name, uuidv7()],
    );
    return r.rows[0].id as string;
  }
  const event = (uid: string, day: number, platform = 'android', hour = 12) =>
    pool.query(`INSERT INTO analytics.events (user_id, session_id, name, platform, at) VALUES ($1, $2, 'app_open', $3, ${at(day, hour)})`, [uid, `s_${run}_${uid.slice(0, 8)}_${day}`, platform]);

  const get = (page: string, who = 'admin', q = `?days=30&country=${C}`) => api().get(`/api/v1/admin/insights/${page}${q}`).set({ Authorization: `Bearer ${tok[who]}` });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    // Corridas anteriores na mesma base: tirar os dados de teste dos países de teste.
    await pool.query("UPDATE identity.users SET country = NULL WHERE country IN ('ZZ', 'ZY')");
    await pool.query("DELETE FROM analytics.search_terms WHERE country IN ('ZZ', 'ZY')");
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'a'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    tok.admin = (await staffLogin(app, 'anadmin')).token;
    const g = await staffLogin(app, 'angrowth', ['crescimento']);
    tok.growth = g.token;
    growthId = g.userId;
    tok.audit = (await staffLogin(app, 'anaudit', ['auditoria'])).token;
    tok.mod = (await staffLogin(app, 'anmod', ['moderacao'])).token;
    tok.fin = (await staffLogin(app, 'anfin', ['financas'])).token;

    // Coorte grande: 25 contas registadas há 20 dias. 0–20 começam no Android, 21–24 no iPhone.
    // Cidades: 0–20 Beira, 21–23 Pemba, 24 sem cidade. A 24 é menor (16 anos).
    for (let i = 0; i < 25; i++) {
      const city = i <= 20 ? 'Beira' : i <= 23 ? 'Pemba' : null;
      const birth = i === 24 ? new Date(Date.now() - 16 * 365.25 * 86_400_000).toISOString().slice(0, 10) : '1995-01-01';
      const id = await user(`b${i}`, -20, { city, birth });
      ids.push(id);
      await event(id, -20, i <= 20 ? 'android' : 'ios', 13);
    }
    // Coorte pequena: 3 contas há 10 dias, só ativas no próprio dia (no site).
    for (let i = 0; i < 3; i++) {
      const id = await user(`s${i}`, -10);
      small.push(id);
      await event(id, -10, 'web', 13);
    }
    // Quem desligou "Ajudar a melhorar" não conta, mesmo com atividade.
    optout = await user('optout', -20, { share: false });
    await event(optout, -19);
    // Um país com poucas pessoas.
    for (let i = 0; i < 2; i++) await user(`y${i}`, -5, { country: 'ZY' });

    // Dia 1: 0–21 voltaram. Dia 7: 10–14. Dia 8: 0–9.
    for (let i = 0; i <= 21; i++) await event(ids[i], -19);
    for (let i = 10; i <= 14; i++) await event(ids[i], -13);
    for (let i = 0; i <= 9; i++) await event(ids[i], -12);

    // Três publicações da conta 0, hoje.
    for (let i = 0; i < 3; i++) await pool.query(`INSERT INTO content.posts (id, author_id, body) VALUES ($3, $1, $2)`, [ids[0], `publicação ${i} #praiaan${run}`, uuidv7()]);

    // Geleira: A em 0–20 e na menor (24); B em 0–19, 22 e 23; C em 0–4.
    const item = async (k: string) =>
      (await pool.query(`INSERT INTO taste.items (id, slug, name, kind, category, status) VALUES ($3, $1, $2, 'comida', 'teste', 'curated') RETURNING id`, [`an-${k}-${run}`, `Item ${k} ${run}`, uuidv7()])).rows[0].id as string;
    const [a, b, c] = [await item('a'), await item('b'), await item('c')];
    const give = (uid: string, it: string) => pool.query('INSERT INTO taste.user_items (user_id, item_id) VALUES ($1, $2)', [uid, it]);
    for (let i = 0; i <= 20; i++) await give(ids[i], a);
    await give(ids[24], a);
    for (const i of [...Array.from({ length: 20 }, (_, x) => x), 22, 23]) await give(ids[i], b);
    for (let i = 0; i <= 4; i++) await give(ids[i], c);

    await app.get(AnalysesService).refresh();
    app.get(AnalysesService).clearCache();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('só quem tem insights.view (Administração, Crescimento, Auditoria) entra; os outros levam 403', async () => {
    await api().get('/api/v1/admin/insights/cohorts').expect(401);
    for (const who of ['mod', 'fin']) {
      await get('cohorts', who).expect(403);
      await api().get('/api/v1/admin/insights/countries').set({ Authorization: `Bearer ${tok[who]}` }).expect(403);
    }
    for (const who of ['admin', 'growth', 'audit']) await get('cohorts', who).expect(200);
    await get('nada').expect(404);
    const me = await api().get('/api/v1/admin/me').set({ Authorization: `Bearer ${tok.growth}` }).expect(200);
    expect(me.body.permissions).toContain('insights.view');
  });

  it('cada consulta fica na auditoria, mesmo quando vem da cache', async () => {
    const count = async () => (await pool.query(`SELECT count(*)::int AS n FROM audit.audit_log WHERE actor_id = $1 AND action = 'insights.view'`, [growthId])).rows[0].n as number;
    const before = await count();
    await get('engagement', 'growth').expect(200);
    await get('engagement', 'growth').expect(200);
    expect(await count()).toBe(before + 2);
    const last = (await pool.query(`SELECT target, metadata FROM audit.audit_log WHERE actor_id = $1 ORDER BY id DESC LIMIT 1`, [growthId])).rows[0];
    expect(last.target).toBe('insights:engagement');
    expect(last.metadata).toEqual({ days: 30, country: C });
  });

  it('países: só com 20 contas ou mais; um país pequeno fica escondido', async () => {
    const r = await api().get('/api/v1/admin/insights/countries').set({ Authorization: `Bearer ${tok.admin}` }).expect(200);
    const zz = r.body.countries.find((x: { code: string }) => x.code === C);
    expect(zz.people).toBe(28); // 25 + 3, sem quem desligou as estatísticas
    expect(r.body.countries.find((x: { code: string }) => x.code === 'ZY')).toBeUndefined();
    const zy = await get('cohorts', 'admin', '?days=30&country=ZY').expect(200);
    expect(zy.body.hidden).toBe(true);
    expect(zy.body.cohorts).toBeUndefined();
  });

  it('coortes e retenção: números certos e os segmentos pequenos escondidos', async () => {
    const r = (await get('cohorts').expect(200)).body;
    expect(r.hidden).toBe(false);
    expect(r.k).toBe(20);
    // Tabela: a coorte grande (25) voltou 60 % na semana 1 (dias 7 a 13: 0–9 e 10–14); a semana 2 ainda não acabou.
    const big = r.cohorts.find((c: { size: number | null }) => c.size === 25);
    expect(big.retention[0]).toBe(60);
    expect(big.retention[1]).toBeNull();
    // A coorte de 3 não mostra o tamanho nem a retenção.
    expect(r.cohorts).toHaveLength(2);
    const tiny = r.cohorts.find((c: { size: number | null }) => c.size === null);
    expect(tiny.retention.every((x: unknown) => x === null || x === 'small')).toBe(true);
    // Curvas: D1 = 22 de 28; D7 = 5 de 28. A conta que desligou as estatísticas não entra.
    expect(r.headline.d1).toBe(78.6);
    expect(r.headline.d1Base).toBe(28);
    expect(r.headline.d7).toBe(17.9);
    expect(r.headline.d30).toBeNull(); // ninguém tem ainda 30 dias
    // Primeira semana (dias 1 a 7): 22 de 28.
    expect(r.all.w1).toBe(78.6);
    // Por plataforma: Android (21) aparece; iPhone (4) e site (3) ficam escondidos.
    const p = (x: string) => r.platforms.find((y: { platform: string }) => y.platform === x);
    expect(p('android').d1).toBe(100);
    expect(p('android').d1Base).toBe(21);
    expect(p('ios').d1).toBeNull();
    expect(p('ios').d1Base).toBeNull();
    expect(p('web').d1Base).toBeNull();
    // Momento aha: ninguém publicou no 1.º dia → o lado "sim" (0) fica escondido.
    const posted = r.aha.find((x: { id: string }) => x.id === 'posted');
    expect(posted.yes.d1).toBeNull();
    expect(posted.no.d1).toBe(78.6);
    expect(posted.liftD1).toBeNull();
    // Stickiness: um ponto por dia do período.
    expect(r.stickiness).toHaveLength(30);
  });

  it('envolvimento: totais, quem cria e quem só vê', async () => {
    const r = (await get('engagement').expect(200)).body;
    expect(r.totals.posts.total).toBe(3);
    expect(r.totals.tchekas.total).toBe(0);
    expect(r.series).toHaveLength(30);
    expect(r.distribution.people).toBe(28);
    expect(r.distribution.creators).toBe(3.6); // 1 de 28
    expect(r.distribution.viewers).toBe(96.4);
    expect(r.distribution.top1Share).toBe(100);
    expect(r.heatmap).toHaveLength(7);
    expect(r.heatmap[0]).toHaveLength(24);
  });

  it('geografia: só cidades com 20 pessoas ou mais', async () => {
    const r = (await get('geo').expect(200)).body;
    expect(r.activePeople).toBe(28);
    expect(r.cities).toEqual([{ country: C, city: 'Beira', people: 21, pct: 75 }]);
    expect(r.otherCities).toEqual({ cities: 1, people: null }); // Pemba (3) escondida
    expect(r.noCity).toBeNull(); // 4 sem cidade
    expect(JSON.stringify(r)).not.toContain('Pemba');
  });

  it('Geleira: gostos e combinações só com 20 pessoas ou mais, sem menores', async () => {
    const r = (await get('geleira').expect(200)).body;
    expect(r.holders).toBe(23); // 0–20, 22 e 23 (a 21 não tem gostos; a menor não conta)
    const zz = r.byCountry.find((x: { country: string }) => x.country === C);
    const names = zz.items.map((x: { name: string }) => x.name);
    expect(names).toContain(`Item b ${run}`);
    expect(names).toContain(`Item a ${run}`);
    expect(names).not.toContain(`Item c ${run}`);
    expect(zz.items.find((x: { name: string }) => x.name === `Item a ${run}`).people).toBe(21); // a menor não conta
    expect(zz.items.find((x: { name: string }) => x.name === `Item b ${run}`).people).toBe(22);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].people).toBe(20);
    expect(r.pairs[0].lift).toBe(1); // 20 × 23 / (21 × 22)
  });

  it('pesquisa: contador agregado, sem a conta, sem menores, um por pessoa/termo/dia e só o termo final', async () => {
    const stats = app.get(SearchStatsService);
    expect(normalizeSearchTerm('  @Praia   do TOFO ')).toBe('praia do tofo');
    expect(normalizeSearchTerm('ze@example.com')).toBeNull();
    expect(normalizeSearchTerm('+258 84 123 4567')).toBeNull();
    expect(normalizeSearchTerm('a')).toBeNull();
    for (let i = 0; i <= 20; i++) stats.note(ids[i], 'Praia do Tofo', false);
    await stats.flush();
    for (let i = 0; i <= 4; i++) stats.note(ids[i], 'segredo', false);
    for (let i = 0; i <= 19; i++) stats.note(ids[i], 'Lugar Inexistente', true);
    // A escrever: "pr", "pra", "praia do tofo" → conta só o último. E a mesma pessoa outra vez no mesmo dia não conta.
    stats.note(ids[22], 'pr', true);
    stats.note(ids[22], 'pra', false);
    stats.note(ids[22], 'praia do tofo', false);
    stats.note(ids[0], 'praia do tofo', false);
    stats.note(ids[24], 'praia do tofo', false); // menor: não entra
    stats.note(optout, 'praia do tofo', false); // desligou: não entra
    await stats.flush();
    await stats.flush();

    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'analytics' AND table_name = 'search_terms'`)).rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(['country', 'day', 'empty', 'searches', 'term']);
    const terms = (await pool.query(`SELECT term FROM analytics.search_terms WHERE country = $1`, [C])).rows.map((r) => r.term);
    expect(terms).not.toContain('pr');
    expect(terms).not.toContain('pra');

    app.get(AnalysesService).clearCache();
    const r = (await get('search').expect(200)).body;
    const top = (t: string) => r.top.find((x: { term: string }) => x.term === t);
    expect(top('praia do tofo').searches).toBe(22);
    expect(top('segredo')).toBeUndefined(); // 5 pessoas: escondido
    expect(r.gaps.map((x: { term: string }) => x.term)).toEqual(['lugar inexistente']);
    expect(r.gaps[0].emptyPct).toBe(100);
    expect(r.totals.searches).toBe(22 + 5 + 20);
  });

  it('a pesquisa da app passa pelo contador (sem guardar quem pesquisou)', async () => {
    const name = `anhttp${run}`.slice(0, 28);
    const reg = await api().post('/api/v1/auth/register').send({ email: `${name}@example.com`, username: name, displayName: name, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    const term = `zzanalise${run.replace(/\d/g, (d) => 'abcdefghij'[Number(d)])}`;
    await api().get(`/api/v1/search?q=${term}`).set({ Authorization: `Bearer ${reg.body.accessToken}` }).expect(200);
    await app.get(SearchStatsService).flush();
    const row = (await pool.query(`SELECT searches, empty FROM analytics.search_terms WHERE term = $1`, [term])).rows[0];
    expect(row).toEqual({ searches: 1, empty: 1 });
  });

  it('as outras páginas respondem com agregados (conteúdo, locais, saúde)', async () => {
    const c = (await get('content').expect(200)).body;
    expect(c.hashtags.top.find((x: { label: string }) => x.label === `praiaan${run}`)).toBeUndefined(); // 1 pessoa só
    const v = (await get('venues').expect(200)).body;
    expect(Array.isArray(v.ranking)).toBe(true);
    const h = (await get('health').expect(200)).body;
    const android = h.versions.find((x: { platform: string }) => x.platform === 'android');
    expect(android.people).toBe(22); // 0–20 e 21 (que voltou no Android)
    const push = h.push.find((x: { platform: string }) => x.platform === 'android');
    expect(push.enabledPct).toBe(0);
    expect(h.push.find((x: { platform: string }) => x.platform === 'ios').enabledPct).toBeNull(); // 4 pessoas
  });
});
