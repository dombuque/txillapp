import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { describeDevice, sessionUserAgent } from '../common/device';
import { uuidv7 } from '../common/uuid7';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOBILE = { 'X-Client': 'txillapp-mobile', 'X-App-Version': '1.25.5', 'X-App-Platform': 'android', 'User-Agent': 'okhttp/4.12.0' };

interface U { token: string; id: string; username: string; email: string; refresh?: string }

describe('Backoffice › Contas: sessões e aparelhos, ficha, filtros, CSV e auditoria (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });
  const audits = async (action: string, target: string) =>
    (await pool.query('SELECT actor_id, metadata FROM audit.audit_log WHERE action = $1 AND target = $2 ORDER BY created_at', [action, target])).rows;

  /** Conta nova, criada pela app nativa (Android 1.25.5): devolve também o token de renovação. */
  async function signup(name: string, birthDate = '1990-06-15'): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const email = `${username}@example.com`;
    const r = await api().post('/api/v1/auth/register').set(MOBILE).set('X-Forwarded-For', `10.9.0.${(n % 250) + 1}`)
      .send({ email, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate, acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username, email, refresh: r.body.refreshToken };
  }
  const login = (u: U, headers: Record<string, string>) => api().post('/api/v1/auth/login').set(headers).send({ identifier: u.username, password: 'password-bem-longa-1' }).expect(200);
  const refreshMobile = (token: string) => api().post('/api/v1/auth/refresh').set(MOBILE).set({ 'X-Requested-With': 'txillapp', 'X-Refresh-Token': token });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('nomes legíveis dos aparelhos (app nativa, app instalada, browser) sem guardar o IP', () => {
    expect(describeDevice(sessionUserAgent({ 'user-agent': 'okhttp/4.12.0', 'x-client': 'txillapp-mobile', 'x-app-version': '1.25.5', 'x-app-platform': 'android' })).label).toBe('Android · app Txillapp 1.25');
    expect(describeDevice(sessionUserAgent({ 'user-agent': 'Txillapp/54 CFNetwork/1568 Darwin/24.1.0', 'x-client': 'txillapp-mobile', 'x-app-version': '1.25.5', 'x-app-platform': 'ios' })).label).toBe('iPhone · app Txillapp 1.25');
    expect(describeDevice(sessionUserAgent({ 'user-agent': IPHONE_SAFARI, 'x-client': 'txillapp-web', 'x-app-display': 'standalone' })).label).toBe('iPhone · Safari (app instalada)');
    expect(describeDevice(WINDOWS_CHROME)).toEqual({ label: 'Windows · Chrome', kind: 'browser', mobile: false });
    expect(describeDevice('okhttp/4.9.2').label).toBe('Android · app Txillapp'); // versões antigas da app
    expect(describeDevice(null).label).toBe('Aparelho desconhecido');
    // Cabeçalhos inventados não entram no que se guarda.
    expect(sessionUserAgent({ 'user-agent': 'okhttp/4.12.0', 'x-client': 'txillapp-mobile', 'x-app-version': '1.2.3; DROP', 'x-app-platform': 'symbian' })).toBe('TxillappApp okhttp/4.12.0');
  });

  it('sessões: o Suporte vê os logins e termina um ou todos; a Moderação não; cada consulta e ação fica na auditoria', async () => {
    const sup = await mkStaff('cs-sup', ['suporte']);
    const mod = await mkStaff('cs-mod', ['moderacao']);
    const user = await signup('csa');
    await login(user, { 'User-Agent': IPHONE_SAFARI, 'X-Client': 'txillapp-web', 'X-App-Display': 'standalone' });
    await login(user, { 'User-Agent': WINDOWS_CHROME });
    await pool.query(`INSERT INTO social.push_devices (token, user_id, platform) VALUES ($1, $2, 'android')`, [`tok-${run}-${'x'.repeat(30)}`, user.id]);

    // Permissões: a Moderação vê a ficha, mas não as sessões.
    await api().get(`/api/v1/admin/users/${user.id}`).set(auth(mod)).expect(200);
    await api().get(`/api/v1/admin/users/${user.id}/sessions`).set(auth(mod)).expect(403);
    await api().post(`/api/v1/admin/users/${user.id}/sessions/revoke-all`).set(auth(mod)).send({ reason: 'não devia' }).expect(403);
    await api().get(`/api/v1/admin/users/${user.id}/sessions`).set(auth(user)).expect(401); // sessão da rede social não entra

    const me = (await api().get('/api/v1/admin/me').set(auth(sup)).expect(200)).body;
    expect(me.permissions).toContain('users.sessions');
    expect(me.permissions).not.toContain('users.export');

    const s1 = (await api().get(`/api/v1/admin/users/${user.id}/sessions`).set(auth(sup)).expect(200)).body as {
      sessions: { id: string; device: string; state: string; loginAt: string; lastActiveAt: string; expiresAt: string }[];
      devices: { platform: string }[];
    };
    expect(s1.sessions.map((s) => s.device).sort()).toEqual(['Android · app Txillapp 1.25', 'Windows · Chrome', 'iPhone · Safari (app instalada)']);
    expect(s1.sessions.every((s) => s.state === 'active' && s.loginAt && s.lastActiveAt && s.expiresAt)).toBe(true);
    expect(s1.devices).toEqual([expect.objectContaining({ platform: 'android' })]);
    expect(JSON.stringify(s1)).not.toMatch(/token|"ip"|10\.9\./i);
    expect(await audits('backoffice.sessions_view', `user:${user.id}`)).toHaveLength(1);

    // Terminar uma sessão: sem motivo falha; com motivo, aquele aparelho deixa de conseguir renovar.
    const android = s1.sessions.find((s) => s.device.startsWith('Android'))!;
    await api().post(`/api/v1/admin/users/${user.id}/sessions/${android.id}/revoke`).set(auth(sup)).send({}).expect(400);
    await api().post(`/api/v1/admin/users/${user.id}/sessions/${android.id}/revoke`).set(auth(sup)).send({ reason: 'telemóvel perdido' }).expect(204);
    await refreshMobile(user.refresh!).expect(401);
    await api().post(`/api/v1/admin/users/${user.id}/sessions/${android.id}/revoke`).set(auth(sup)).send({ reason: 'outra vez' }).expect(400);
    const other = await signup('csx');
    await api().post(`/api/v1/admin/users/${other.id}/sessions/${android.id}/revoke`).set(auth(sup)).send({ reason: 'conta errada' }).expect(404);
    const revoked = await audits('backoffice.session_revoke', `user:${user.id}`);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toMatchObject({ actor_id: sup.id, metadata: { family: android.id, device: 'Android · app Txillapp 1.25', reason: 'telemóvel perdido' } });

    const s2 = (await api().get(`/api/v1/admin/users/${user.id}/sessions`).set(auth(sup)).expect(200)).body.sessions as { id: string; state: string }[];
    expect(s2.find((s) => s.id === android.id)!.state).toBe('ended');
    expect(s2.filter((s) => s.state === 'active')).toHaveLength(2);

    // O dono vê a mesma lista, com nomes legíveis (o Android já não aparece).
    const own = (await api().get('/api/v1/auth/sessions').set(auth(user)).expect(200)).body as { device: string; mobile: boolean }[];
    expect(own.map((d) => d.device).sort()).toEqual(['Windows · Chrome', 'iPhone · Safari (app instalada)']);
    expect(own.find((d) => d.device.startsWith('iPhone'))!.mobile).toBe(true);

    // Terminar todas: as sessões e as notificações dos telemóveis.
    expect((await api().post(`/api/v1/admin/users/${user.id}/sessions/revoke-all`).set(auth(sup)).send({ reason: 'conta comprometida' }).expect(200)).body).toEqual({ sessions: 2 });
    const s3 = (await api().get(`/api/v1/admin/users/${user.id}/sessions`).set(auth(sup)).expect(200)).body;
    expect(s3.sessions.every((s: { state: string }) => s.state === 'ended')).toBe(true);
    expect(s3.devices).toEqual([]);
    expect(await audits('backoffice.sessions_revoke_all', `user:${user.id}`)).toEqual([expect.objectContaining({ metadata: { sessions: 2, pushDevices: 1, reason: 'conta comprometida' } })]);
    expect(await audits('backoffice.sessions_view', `user:${user.id}`)).toHaveLength(3);

    // Uma sessão expirada aparece como expirada.
    const late = await signup('csl');
    await pool.query(`UPDATE identity.sessions SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [late.id]);
    expect((await api().get(`/api/v1/admin/users/${late.id}/sessions`).set(auth(sup)).expect(200)).body.sessions[0].state).toBe('expired');

    // O histórico da ficha mostra o que a equipa fez.
    const sheet = (await api().get(`/api/v1/admin/users/${user.id}`).set(auth(sup)).expect(200)).body;
    expect(sheet.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['backoffice.sessions_view', 'backoffice.session_revoke', 'backoffice.sessions_revoke_all']));
  });

  it('ficha: resumo com idade e menor, atividade (contagens e últimas publicações), queixas feitas e recebidas', async () => {
    const adm = await mkStaff('cs-adm');
    const teen = await signup('cst', new Date(Date.now() - 15.5 * 365.25 * 86400_000).toISOString().slice(0, 10));
    const rep = await signup('csr');
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id IN ($1, $2)', [teen.id, rep.id]);
    const posts: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = uuidv7();
      await pool.query('INSERT INTO content.posts (id, author_id, body) VALUES ($1, $2, $3)', [id, teen.id, `publicação ${i}`]);
      posts.push(id);
    }
    await api().post('/api/v1/reports').set(auth(rep)).send({ type: 'post', id: posts[0], reason: 'spam' }).expect(204);

    const s = (await api().get(`/api/v1/admin/users/${teen.id}`).set(auth(adm)).expect(200)).body;
    expect(s.user).toMatchObject({ username: teen.username, minor: true, age: 15, posts: 12, comments: 0, stories: 0, followers: 0, following: 0 });
    expect(s.recentPosts).toHaveLength(10);
    expect(s.recentPosts[0]).toMatchObject({ id: posts[11], body: 'publicação 11' });
    expect(s.reportsAgainst).toEqual([expect.objectContaining({ reason: 'spam', status: 'open', reporter: rep.username })]);
    expect(s.reportCounts).toEqual({ against: 1, against_open: 1, made: 0 });
    expect(JSON.stringify(s.reportsAgainst)).not.toContain('evidence');

    const r = (await api().get(`/api/v1/admin/users/${rep.id}`).set(auth(adm)).expect(200)).body;
    expect(r.user.minor).toBe(false);
    expect(r.reportsMade).toEqual([expect.objectContaining({ target_type: 'post', reason: 'spam', target_owner: teen.username })]);
    expect(r.reportCounts.made).toBe(1);
  });

  it('lista: filtros (estado, verificado, país, datas, com queixas, menores), ordenação e páginas por cursor; CSV com permissão e auditoria', async () => {
    const adm = await mkStaff('cs-lst');
    const sup = await mkStaff('cs-ls2', ['suporte']);
    const tag = `csf${run}`;
    const a = await signup(`${tag}a`);
    const b = await signup(`${tag}b`, new Date(Date.now() - 16.5 * 365.25 * 86400_000).toISOString().slice(0, 10));
    const c = await signup(`${tag}c`);
    await pool.query(`UPDATE identity.users SET country = 'AO', email_verified_at = now(), created_at = '2025-01-10' WHERE id = $1`, [a.id]);
    await pool.query(`UPDATE identity.users SET country = 'PT', created_at = '2025-03-10' WHERE id = $1`, [b.id]);
    await pool.query(`UPDATE identity.users SET country = 'PT', status = 'suspended', created_at = '2025-05-10' WHERE id = $1`, [c.id]);
    await pool.query(`INSERT INTO social.reports (id, reporter_id, target_type, target_id, target_user_id, reason) VALUES (gen_random_uuid(), $1, 'user', $2, $2, 'spam'), (gen_random_uuid(), $3, 'user', $2, $2, 'hate')`, [a.id, c.id, b.id]);

    const names = async (query: Record<string, string>, who = adm) =>
      ((await api().get('/api/v1/admin/users').query({ q: tag, ...query }).set(auth(who)).expect(200)).body.items as { username: string }[]).map((x) => x.username);
    expect(await names({})).toEqual([c.username, b.username, a.username]); // recentes primeiro
    expect(await names({ sort: 'oldest' })).toEqual([a.username, b.username, c.username]);
    expect(await names({ sort: 'username' })).toEqual([a.username, b.username, c.username]);
    expect((await names({ sort: 'reports' }))[0]).toBe(c.username);
    expect(await names({ status: 'suspended' })).toEqual([c.username]);
    expect(await names({ verified: 'email' })).toEqual([a.username]);
    expect(await names({ verified: 'unconfirmed' })).toEqual([c.username, b.username]);
    expect(await names({ country: 'pt' })).toEqual([c.username, b.username]);
    expect(await names({ from: '2025-02-01', to: '2025-03-10' })).toEqual([b.username]);
    expect(await names({ reports: '1' })).toEqual([c.username]);
    expect(await names({ minors: '1' })).toEqual([b.username]);
    expect(await names({ country: 'xx1', sort: 'inventada', from: 'ontem' })).toHaveLength(3); // filtros inválidos são ignorados
    const row = (await api().get('/api/v1/admin/users').query({ q: c.username }).set(auth(adm)).expect(200)).body.items[0];
    expect(row).toMatchObject({ reports: 2, reports_open: 2, status: 'suspended', minor: false });

    // Páginas por cursor, em cada ordenação, sem repetir nem saltar.
    for (const sort of ['recent', 'oldest', 'username', 'reports', 'followers', 'last_seen']) {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 5; i++) {
        const page = (await api().get('/api/v1/admin/users').query({ q: tag, sort, ...(cursor ? { cursor } : {}) }).set(auth(adm)).expect(200)).body;
        expect(page.items.length).toBeLessThanOrEqual(30);
        seen.push(...page.items.map((x: { id: string }) => x.id));
        cursor = page.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(new Set(seen).size).toBe(3);
    }
    const p1 = await api().get('/api/v1/admin/users').query({ cursor: 'lixo' }).set(auth(adm)).expect(200);
    expect(Array.isArray(p1.body.items)).toBe(true);

    // CSV: só quem tem users.export; sem campos sensíveis; fica na auditoria.
    await api().get('/api/v1/admin/users/export.csv').query({ q: tag }).set(auth(sup)).expect(403);
    const csv = await api().get('/api/v1/admin/users/export.csv').query({ q: tag, country: 'PT' }).set(auth(adm)).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="contas-/);
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('id,username,estado,pais,email_confirmado,selo,criada,ultima_atividade,publicacoes,seguidores,queixas_recebidas');
    expect(lines).toHaveLength(3);
    expect(csv.text).not.toContain(b.email);
    expect(csv.text).not.toMatch(/@example\.com|Teste|2010|birth/);
    const exp = (await pool.query(`SELECT metadata FROM audit.audit_log WHERE action = 'backoffice.users_export' AND actor_id = $1`, [adm.id])).rows;
    expect(exp).toEqual([{ metadata: { filters: { q: tag, country: 'PT', sort: 'recent' }, rows: 2 } }]);
  });

  /** Conta de equipa já configurada; id = identidade interna (a da auditoria). */
  async function mkStaff(name: string, teams: string[] = ['administracao']) {
    const st = await staffLogin(app, name, teams);
    return { token: st.token, id: st.userId };
  }
});
