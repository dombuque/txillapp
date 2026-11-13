import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MailService } from '../mail/mail.service';
import { InvitesService } from '../invites/invites.service';
import { registry } from '../observability/metrics';
import { staffLogin } from '../staff/staff-test';
import { LOGIN, REGISTER, RISK } from './rules';
import { SecurityService } from './security.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const WEB = { 'X-Client': 'txillapp-web', 'X-Requested-With': 'txillapp' };
const MOBILE = { 'X-Client': 'txillapp-mobile', 'X-Requested-With': 'txillapp', 'X-App-Version': '1.46.0', 'X-App-Platform': 'android', 'User-Agent': 'okhttp/4.12.0' };

interface U { id: string; username: string; email: string; token: string; refresh?: string; ip: string }

describe('segurança das contas: força bruta, registo em massa, contas falsas, convites e sessões (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let mail: MailService;
  let sec: SecurityService;
  const run = Date.now().toString(36);
  // IPs de documentação (2001:db8::/32), cada um na sua rede /48: os contadores na base de dados não chocam entre testes nem corridas.
  const base = Math.floor(Math.random() * 0xe000) + 0x1000;
  let seq = 0;
  /** Uma rede /48 nova («2001:db8:abcd»). */
  const freshNet = () => `2001:db8:${((base + ++seq) % 0xffff).toString(16)}`;
  /** Um «IP» público novo, numa rede nova. */
  const freshIp = () => `${freshNet()}::1`;
  const api = () => request(app.getHttpServer());
  const bearer = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };
  const mailsTo = (email: string) => mail.outbox.filter((m) => m.to === email);
  const waitFor = async (f: () => Promise<boolean> | boolean, what: string) => {
    for (let i = 0; i < 60; i++) {
      if (await f()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`à espera de: ${what}`);
  };
  const events = async (kind: string, userId?: string) =>
    (await pool.query('SELECT * FROM security.events WHERE kind = $1 AND ($2::uuid IS NULL OR user_id = $2) ORDER BY created_at', [kind, userId ?? null])).rows;
  const risk = async (x: { id: string }) => (await pool.query('SELECT * FROM security.account_risk WHERE user_id = $1', [x.id])).rows[0];
  const metric = async (name: string, labels: Record<string, string> = {}) => {
    const m = (await registry.getSingleMetric(name)?.get()) as { values: { value: number; labels: Record<string, string> }[] } | undefined;
    return (m?.values ?? []).filter((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val)).reduce((s, v) => s + v.value, 0);
  };

  async function signup(name: string, o: { ip?: string; headers?: Record<string, string>; username?: string; displayName?: string; email?: string; verified?: boolean; code?: string } = {}): Promise<U> {
    const username = (o.username ?? `${name}${run}${seq}`).slice(0, 30);
    const email = o.email ?? `${username}@example.com`;
    const ip = o.ip ?? freshIp();
    const r = await api().post('/api/v1/auth/register').set(o.headers ?? MOBILE).set('X-Forwarded-For', ip)
      .send({ email, username, displayName: o.displayName ?? `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true, inviteCode: o.code })
      .expect(201);
    if (o.verified !== false) await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { id: r.body.user.id, username, email, token: r.body.accessToken, refresh: r.body.refreshToken, ip };
  }
  const login = (identifier: string, password: string, ip: string, headers: Record<string, string> = MOBILE) =>
    api().post('/api/v1/auth/login').set(headers).set('X-Forwarded-For', ip).send({ identifier, password });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', MAIL_CAPTURE: 'true', PUBLIC_URL: 'https://txillapp.com' }));
    await app.init();
    mail = app.get(MailService);
    sec = app.get(SecurityService);
  }, 60_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('força bruta: 5 senhas erradas bloqueiam a conta (sem correr o hash), avisam o dono por email, e recuperar a senha desbloqueia; o 2.º bloqueio dura o dobro', async () => {
    const u = await signup('bf');
    const ip = freshIp();
    const hashes = jest.spyOn(sec.hashGate, 'run');
    for (let i = 1; i <= LOGIN.ACCOUNT_LOCK_AFTER; i++) {
      const r = await login(u.username, `errada-errada-${i}`, ip).expect(401);
      expect(r.body).not.toHaveProperty('code');
      expect(r.body.message).toBe('Credenciais inválidas');
    }
    // Bloqueada: até a senha certa recebe 429 com o tempo de espera, e o argon2 nem corre.
    hashes.mockClear();
    const locked = await login(u.username, PASSWORD, ip).expect(429);
    expect(locked.body).toMatchObject({ code: 'login_locked', retryAfter: expect.any(Number) });
    expect(locked.body.message).toContain('Esqueci-me da senha');
    expect(locked.body.retryAfter).toBeGreaterThan(14 * 60);
    expect(hashes).not.toHaveBeenCalled();
    // Pelo email também (é a mesma conta), e a partir de outra rede.
    await login(u.email, PASSWORD, freshIp()).expect(429);
    hashes.mockRestore();
    // O aviso ao dono, os eventos, a auditoria e as métricas.
    await waitFor(() => mailsTo(u.email).some((m) => m.subject === 'Alguém tentou entrar na tua conta'), 'o email do bloqueio');
    const warn = mailsTo(u.email).find((m) => m.subject === 'Alguém tentou entrar na tua conta')!;
    expect(warn.text).toContain('Android · app Txillapp 1.46');
    expect(warn.text).toContain('https://txillapp.com/forgot-password');
    await waitFor(async () => (await events('login_locked', u.id)).length === 1, 'o evento do bloqueio');
    await waitFor(async () => (await events('login_failed', u.id)).length === LOGIN.ACCOUNT_LOCK_AFTER, 'as falhas nos eventos');
    expect((await events('login_failed', u.id))[0].ip_hash).toMatch(/^[0-9a-f]{32}$/); // impressão, nunca o IP
    expect(JSON.stringify(await events('login_failed', u.id))).not.toContain('2001:db8');
    await waitFor(async () => (await pool.query("SELECT 1 FROM audit.audit_log WHERE action = 'auth.login_locked' AND actor_id = $1", [u.id])).rowCount === 1, 'a auditoria');
    expect(await metric('txill_security_events_total', { kind: 'login_locked' })).toBeGreaterThanOrEqual(1);
    expect(await metric('txill_auth_login_total', { result: 'locked' })).toBeGreaterThanOrEqual(2);

    // «Esqueci-me da senha» → nova senha: desbloqueia.
    resetThrottle();
    await api().post('/api/v1/auth/password/forgot').set(MOBILE).send({ email: u.email }).expect(200);
    await waitFor(() => mailsTo(u.email).some((m) => m.subject === 'Define uma senha nova'), 'o email de recuperar');
    const token = decodeURIComponent(/token=([^\s"&]+)/.exec(mailsTo(u.email).find((m) => m.subject === 'Define uma senha nova')!.text)![1]);
    await api().post('/api/v1/auth/password/reset').send({ token, newPassword: 'nova-senha-bem-longa-2' }).expect(200);
    await login(u.username, 'nova-senha-bem-longa-2', ip).expect(200);

    // Espera progressiva: bloqueios seguidos (em 24 h) duram o dobro.
    resetThrottle();
    const v = await signup('bf2');
    for (let i = 0; i < LOGIN.ACCOUNT_LOCK_AFTER; i++) await login(v.username, 'errada-errada-x', ip).expect(401);
    const first = (await login(v.username, PASSWORD, ip).expect(429)).body.retryAfter as number;
    const vKeys = [`login:acct:${v.id}`, `login:id:${sec.print('login', v.username)}`];
    await pool.query("UPDATE security.locks SET until = now() - interval '1 second' WHERE key = ANY($1)", [vKeys]);
    resetThrottle();
    await login(v.username, PASSWORD, ip).expect(200); // passou o bloqueio: entra (e o login certo limpa as falhas)
    resetThrottle();
    for (let i = 0; i < LOGIN.ACCOUNT_LOCK_AFTER; i++) await login(v.username, 'errada-errada-y', ip).expect(401);
    const second = (await login(v.username, PASSWORD, ip).expect(429)).body.retryAfter as number;
    expect(second).toBeGreaterThan(first * 1.8);
    expect(second).toBeLessThanOrEqual(LOGIN.ACCOUNT_LOCK_BASE_MS * 2 / 1000 + 5);
  });

  it('conta que não existe: a mesma resposta, praticamente o mesmo tempo e o mesmo bloqueio que uma senha errada', async () => {
    const u = await signup('ghost');
    const ip = freshIp();
    const time = async (identifier: string) => {
      const t = process.hrtime.bigint();
      const r = await login(identifier, 'errada-errada-1', ip);
      return { ms: Number(process.hrtime.bigint() - t) / 1e6, status: r.status, body: r.body };
    };
    const real: number[] = [];
    const ghost: number[] = [];
    for (let i = 0; i < 4; i++) {
      resetThrottle();
      const a = await time(u.username);
      const b = await time(`ninguem${run}${i}@example.com`);
      expect(b.status).toBe(a.status);
      expect(b.body).toEqual(a.body);
      real.push(a.ms);
      ghost.push(b.ms);
    }
    const median = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
    // O argon2 corre nos dois casos (com um hash falso para quem não existe): a diferença fica muito abaixo do custo do hash.
    expect(Math.abs(median(real) - median(ghost))).toBeLessThan(Math.max(median(real), median(ghost)) * 0.6);
    // E o bloqueio também chega a um email que não existe, com a mesma resposta.
    const nobody = `fantasma${run}@example.com`;
    resetThrottle();
    for (let i = 0; i < LOGIN.ACCOUNT_LOCK_AFTER; i++) await login(nobody, 'x-x-x-x-x-x', ip).expect(401);
    const r = await login(nobody, 'x-x-x-x-x-x', ip).expect(429);
    expect(r.body.code).toBe('login_locked');
  });

  it('por IP: muitas falhas da mesma rede bloqueiam o IP para todas as contas (espera progressiva); outro IP continua a entrar', async () => {
    const victim = await signup('ipv');
    const ip = freshIp();
    for (let i = 0; i < LOGIN.IP_LOCK_AFTER; i++) {
      if (i % 9 === 0) resetThrottle(); // o travão por minuto da API é outro assunto
      await login(`alvo${run}${i}@example.com`, 'errada-errada-1', ip).expect(401);
    }
    const r = await login(victim.username, PASSWORD, ip).expect(429);
    expect(r.body.code).toBe('login_ip_locked');
    expect(r.body.retryAfter).toBeGreaterThan(0);
    await login(victim.username, PASSWORD, freshIp()).expect(200);
    await waitFor(async () => (await events('ip_locked')).length >= 1, 'o evento do IP bloqueado');
  });

  it('registo em massa: limites por IP (hora) e por rede (dia); os IP internos não contam', async () => {
    const ip = freshIp();
    for (let i = 0; i < REGISTER.PER_IP_HOUR; i++) await signup(`rm${i}`, { ip });
    const r = await api().post('/api/v1/auth/register').set(MOBILE).set('X-Forwarded-For', ip)
      .send({ email: `rmx${run}@example.com`, username: `rmx${run}`, displayName: 'Rm', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(429);
    expect(r.body).toMatchObject({ code: 'register_limit' });
    expect(await metric('txill_auth_register_total', { result: 'limited' })).toBeGreaterThanOrEqual(1);
    // A mesma rede (/48 no IPv6): com o dia cheio, um IP novo dessa rede também para.
    const p48 = freshNet();
    const ctx = sec.context({ ip: `${p48}:1::1`, headers: {} } as never);
    await pool.query(`INSERT INTO security.counters (key, hits, expires_at) VALUES ($1, $2, now() + interval '1 day') ON CONFLICT (key) DO UPDATE SET hits = EXCLUDED.hits`, [`reg:net:d:${ctx.net}`, REGISTER.PER_NET_DAY]);
    resetThrottle();
    await api().post('/api/v1/auth/register').set(MOBILE).set('X-Forwarded-For', `${p48}:2::1`)
      .send({ email: `rmy${run}@example.com`, username: `rmy${run}`, displayName: 'Rm', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(429);
    await pool.query('DELETE FROM security.counters WHERE key = $1', [`reg:net:d:${ctx.net}`]);
    // Outra rede passa; e pedidos internos (127.0.0.1, redes privadas) nunca contam.
    await signup('rmz');
    resetThrottle();
    for (let i = 0; i < REGISTER.PER_IP_HOUR + 1; i++) await signup(`rmi${i}`, { ip: '10.99.0.1' });
  });

  it('email temporário: o registo é recusado antes do hash (também em subdomínios)', async () => {
    const hashes = jest.spyOn(sec.hashGate, 'run');
    for (const domain of ['mailinator.com', 'abc.yopmail.com']) {
      const r = await api().post('/api/v1/auth/register').set(MOBILE).set('X-Forwarded-For', freshIp())
        .send({ email: `tmp${run}@${domain}`, username: `tmp${run}${seq}`, displayName: 'Tmp', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(400);
      expect(r.body).toMatchObject({ code: 'disposable_email' });
    }
    expect(hashes).not.toHaveBeenCalled();
    hashes.mockRestore();
    // O evento é escrito em segundo plano (nunca atrasa a resposta).
    await waitFor(async () => (await events('register_disposable')).length >= 2, 'os eventos do email temporário');
  });

  it('«Este email já tem conta?» e «Esqueci-me da senha» não servem para varrer emails nem para encher a caixa de alguém', async () => {
    const u = await signup('mb');
    const ip = freshIp();
    await pool.query(`INSERT INTO security.counters (key, hits, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [`emailcheck:${sec.context({ ip, headers: {} } as never).ip}`, REGISTER.EMAIL_CHECKS_PER_IP_HOUR]);
    expect((await api().get(`/api/v1/auth/email-available?email=${u.email}`).set('X-Forwarded-For', ip).expect(429)).body.code).toBe('email_check_limit');
    await api().get(`/api/v1/auth/email-available?email=${u.email}`).set('X-Forwarded-For', freshIp()).expect(200);
    // Recuperar a senha: no máximo 3 emails por hora para o mesmo endereço, sempre com a mesma resposta.
    const before = mailsTo(u.email).filter((m) => m.subject === 'Define uma senha nova').length;
    for (let i = 0; i < 5; i++) {
      resetThrottle();
      expect((await api().post('/api/v1/auth/password/forgot').set('X-Forwarded-For', freshIp()).send({ email: u.email }).expect(200)).body).toEqual({ ok: true });
    }
    expect(mailsTo(u.email).filter((m) => m.subject === 'Define uma senha nova').length - before).toBe(3);
  });

  it('pontuação de risco: muitas contas na mesma instalação e nomes gerados vão para a fila; a conta marcada fica limitada; a equipa decide e tudo fica na auditoria', async () => {
    const device = { ...MOBILE, 'X-Install-Id': `inst${run}abcdefghijklmnop` };
    const accounts: U[] = [];
    for (let i = 0; i < 5; i++) accounts.push(await signup('rk', { headers: device, username: `qx${run}${i}84736251`.slice(0, 30), displayName: `qx${run}${i}84736251`.slice(0, 30) }));
    const first = await risk(accounts[0]);
    expect(first.state).toBe('ok');
    expect(first.device_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(first.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    const last = await risk(accounts[4]);
    expect(last.signals).toMatchObject({ mesmo_aparelho: 40, nome_gerado: 20 });
    expect(last.score).toBeGreaterThanOrEqual(RISK.FLAG);
    expect(last.state).toBe('flagged');
    expect(new Date(last.limited_until).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    await waitFor(async () => (await events('risk_flagged', accounts[4].id)).length === 1, 'o evento da conta marcada');

    // Limites de uma conta marcada: não escreve a desconhecidos nem envia Txills; a quem a segue escreve.
    const sus = accounts[4];
    resetThrottle();
    const stranger = await signup('rks');
    const friend = await signup('rkf');
    const dm = await api().post(`/api/v1/chat/with/${stranger.username}`).set(bearer(sus)).send({ kind: 'text', body: 'olá, tudo bem contigo?' }).expect(403);
    expect(dm.body.code).toBe('risk_limited');
    await api().post(`/api/v1/users/${sus.username}/follow`).set(bearer(friend)).expect(200);
    await api().post(`/api/v1/chat/with/${friend.username}`).set(bearer(sus)).send({ kind: 'text', body: 'olá amigo' }).expect(201);
    for (const x of [sus, friend, stranger]) await api().get('/api/v1/wallet').set(bearer(x)).expect(200);
    const tr = await api().post('/api/v1/wallet/transfers').set(bearer(sus)).set('Idempotency-Key', `tr-${run}-1`).send({ toUsername: friend.username, amount: 10 }).expect(403);
    expect(tr.body.code).toBe('risk_limited');
    // As contas antigas e as normais não têm limites nenhuns.
    await api().post('/api/v1/wallet/transfers').set(bearer(friend)).set('Idempotency-Key', `tr-${run}-2`).send({ toUsername: stranger.username, amount: 10 }).expect(201);

    // A fila do backoffice: a Moderação vê e decide; o Suporte vê mas não decide.
    const mod = await staffLogin(app, 'rk-mod', ['moderacao']);
    const sup = await staffLogin(app, 'rk-sup', ['suporte']);
    const q = (await api().get('/api/v1/admin/risk').set(bearer(mod)).expect(200)).body;
    const row = q.items.find((i: { user: { id: string } }) => i.user.id === sus.id);
    expect(row).toMatchObject({ state: 'flagged', user: { username: sus.username, emailDomain: 'example.com' }, related: { sameDevice: 4 } });
    expect(row.signals.map((s: { label: string }) => s.label)).toContain('Várias contas na mesma instalação da app');
    expect(JSON.stringify(row)).not.toContain(sus.email); // nunca o email completo
    expect(q.counts.flagged).toBeGreaterThanOrEqual(1);
    await api().post(`/api/v1/admin/risk/${sus.id}/decide`).set(bearer(sup)).send({ decision: 'clear', reason: 'parece real' }).expect(403);

    // «É verdadeira»: sai da fila, acabam os limites e os sinais novos já não a põem lá.
    expect((await api().post(`/api/v1/admin/risk/${sus.id}/decide`).set(bearer(mod)).send({ decision: 'clear', reason: 'falei com a pessoa' }).expect(200)).body).toEqual({ state: 'cleared' });
    await api().post(`/api/v1/chat/with/${stranger.username}`).set(bearer(sus)).send({ kind: 'text', body: 'olá, tudo bem contigo?' }).expect(201);
    expect((await risk(sus)).state).toBe('cleared');
    // «Limitar» e «Suspender».
    const other = accounts[3];
    await pool.query("UPDATE security.account_risk SET state = 'flagged' WHERE user_id = $1", [other.id]);
    await api().post(`/api/v1/admin/risk/${other.id}/decide`).set(bearer(mod)).send({ decision: 'limit', reason: 'muito parecida com outras' }).expect(200);
    const lim = await risk(other);
    expect(lim.state).toBe('limited');
    expect(new Date(lim.limited_until).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
    await api().post(`/api/v1/chat/with/${stranger.username}`).set(bearer(other)).send({ kind: 'text', body: 'olá' }).expect(403);
    await api().post(`/api/v1/admin/risk/${other.id}/decide`).set(bearer(mod)).send({ decision: 'suspend', reason: 'conta falsa' }).expect(200);
    expect((await pool.query('SELECT status FROM identity.users WHERE id = $1', [other.id])).rows[0].status).toBe('suspended');
    await login(other.username, PASSWORD, freshIp()).expect(401);
    const audit = (await pool.query("SELECT action FROM audit.audit_log WHERE target = $1 ORDER BY created_at", [`user:${other.id}`])).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['backoffice.risk_limit', 'backoffice.suspend', 'backoffice.risk_suspend']));
    expect((await pool.query("SELECT 1 FROM audit.audit_log WHERE action = 'backoffice.risk_clear' AND target = $1", [`user:${sus.id}`])).rowCount).toBe(1);
  });

  it('rajadas nas primeiras 48 horas: a mesma mensagem para 5 pessoas marca a conta', async () => {
    const spamName = `zx${run}9183746`.slice(0, 30);
    const spam = await signup('sp', { username: spamName, displayName: spamName });
    const before = (await risk(spam)).score as number;
    const targets: U[] = [];
    for (let i = 0; i < 5; i++) targets.push(await signup(`spt${i}`));
    for (const t of targets) await api().post(`/api/v1/chat/with/${t.username}`).set(bearer(spam)).send({ kind: 'text', body: 'Ganha Txills grátis em http://exemplo.test' }).expect(201);
    const r = await risk(spam);
    expect(r.signals.mensagens_iguais).toBe(RISK.POINTS.mensagens_iguais);
    expect(r.score).toBeGreaterThan(before);
    expect(r.state).toBe('flagged');
    // A partir daqui, a quem não a segue já não escreve.
    const another = await signup('spu');
    expect((await api().post(`/api/v1/chat/with/${another.username}`).set(bearer(spam)).send({ kind: 'text', body: 'olá' }).expect(403)).body.code).toBe('risk_limited');
  });

  it('convites: o prémio só chega quando a conta convidada é real; mesmo aparelho, mesmo email disfarçado e conta em revisão não dão prémio', async () => {
    const invites = app.get(InvitesService);
    const inviter = await signup('ivr', { email: `ana.sitoe${run}@gmail.com` });
    await pool.query("UPDATE identity.users SET created_at = now() - interval '5 days' WHERE id = $1", [inviter.id]);
    const code = (await api().get('/api/v1/invites/me').set(bearer(inviter)).expect(200)).body.code as string;
    const status = async (x: U) => (await pool.query('SELECT status, reason FROM social.referrals WHERE invitee_id = $1', [x.id])).rows[0];
    const wait = () => new Promise((r) => setTimeout(r, 250));
    const backdate = (x: U) => pool.query("UPDATE identity.users SET created_at = now() - interval '13 hours' WHERE id = $1", [x.id]);
    const post = (x: U) => api().post('/api/v1/posts').set(bearer(x)).send({ body: 'olá malta', mediaIds: [] }).expect(201);

    // Uma pessoa a sério: só depois de voltar ao Txillapp (12 h depois) e com alguma atividade.
    const real = await signup('ivreal', { code, headers: { ...MOBILE, 'X-Install-Id': `real${run}aaaaaaaaaaaaaaaa` } });
    await wait();
    await post(real);
    await invites.sweep();
    expect((await status(real)).status).toBe('registered');
    await backdate(real);
    await invites.sweep();
    expect((await status(real)).status).toBe('qualified');

    // O mesmo aparelho de outro convidado: sem prémio.
    const twin = await signup('ivtwin', { code, headers: { ...MOBILE, 'X-Install-Id': `real${run}aaaaaaaaaaaaaaaa` } });
    await wait();
    expect(await status(twin)).toMatchObject({ status: 'blocked', reason: 'mesmo aparelho' });
    // O email de quem convida, disfarçado (pontos e +): sem prémio.
    const alias = await signup('ivalias', { code, email: `a.n.a.sitoe${run}+2@gmail.com` });
    await wait();
    expect(await status(alias)).toMatchObject({ status: 'blocked', reason: 'mesmo email' });
    expect((await risk(alias)).email_hash).toMatch(/^[0-9a-f]{32}$/);

    // Marcada como suspeita: o convite espera pela equipa (não perde o prémio se for verdadeira).
    const sus = await signup('ivsus', { code });
    await wait();
    await post(sus);
    await backdate(sus);
    await pool.query("UPDATE security.account_risk SET state = 'flagged', limited_until = now() + interval '1 day' WHERE user_id = $1", [sus.id]);
    await invites.sweep();
    expect((await status(sus)).status).toBe('registered');
    await pool.query("UPDATE security.account_risk SET state = 'cleared' WHERE user_id = $1", [sus.id]);
    await invites.sweep();
    expect((await status(sus)).status).toBe('qualified');
  });

  it('sessões: reutilizar um token de renovação já trocado termina a sessão, fica nos eventos e avisa o dono; novo aparelho manda «Novo início de sessão»; «terminar as outras» deixa só esta', async () => {
    const u = await signup('ses');
    const refresh = (token: string) => api().post('/api/v1/auth/refresh').set(MOBILE).set({ 'X-Refresh-Token': token });
    const r1 = await refresh(u.refresh!).expect(200);
    // Passou a tolerância de rede (2 minutos) e o token antigo volta a aparecer: roubo. A família toda termina.
    await pool.query("UPDATE identity.sessions SET used_at = now() - interval '5 minutes' WHERE user_id = $1 AND used_at IS NOT NULL", [u.id]);
    await refresh(u.refresh!).expect(401);
    await refresh(r1.body.refreshToken).expect(401); // o token novo também já não vale
    await waitFor(async () => (await events('refresh_reuse', u.id)).length === 1, 'o evento de reutilização');
    await waitFor(() => mailsTo(u.email).some((m) => m.subject === 'Terminámos uma sessão por segurança'), 'o email de reutilização');
    expect((await pool.query("SELECT 1 FROM audit.audit_log WHERE action = 'auth.refresh_reuse_detected' AND actor_id = $1", [u.id])).rowCount).toBeGreaterThanOrEqual(1);

    // Entrar num aparelho novo (Windows · Chrome): email «Novo início de sessão». No mesmo aparelho outra vez: nada.
    const chrome = { ...WEB, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' };
    await login(u.username, PASSWORD, freshIp(), chrome).expect(200);
    await waitFor(() => mailsTo(u.email).some((m) => m.subject === 'Novo início de sessão no Txillapp'), 'o email do novo início de sessão');
    expect(mailsTo(u.email).find((m) => m.subject === 'Novo início de sessão no Txillapp')!.text).toContain('Windows · Chrome');
    const phone = await login(u.username, PASSWORD, freshIp()).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(mailsTo(u.email).filter((m) => m.subject === 'Novo início de sessão no Txillapp')).toHaveLength(1);

    // «Terminar sessão em todos os outros aparelhos».
    const auth = { Authorization: `Bearer ${phone.body.accessToken}`, 'X-Refresh-Token': phone.body.refreshToken as string, ...MOBILE };
    expect((await api().get('/api/v1/auth/sessions').set(auth).expect(200)).body.length).toBeGreaterThanOrEqual(2);
    await api().post('/api/v1/auth/sessions/revoke-others').set(auth).expect(204);
    const left = (await api().get('/api/v1/auth/sessions').set(auth).expect(200)).body as { current: boolean }[];
    expect(left).toHaveLength(1);
    expect(left[0].current).toBe(true);
  });

  it('prazos: a limpeza apaga contadores e bloqueios acabados, eventos com mais de 90 dias e as impressões com mais de 90 dias', async () => {
    const u = await signup('prz');
    await pool.query(`INSERT INTO security.counters (key, hits, expires_at) VALUES ($1, 1, now() - interval '1 minute')`, [`velho:${run}`]);
    await pool.query(`INSERT INTO security.locks (key, until, strikes, forget_at) VALUES ($1, now() - interval '2 days', 1, now() - interval '1 day')`, [`velho:${run}`]);
    await pool.query(`INSERT INTO security.events (id, kind, user_id, created_at) VALUES (gen_random_uuid(), 'login_failed', $1, now() - interval '91 days')`, [u.id]);
    await pool.query("UPDATE security.account_risk SET created_at = now() - interval '91 days' WHERE user_id = $1", [u.id]);
    const r = await sec.purge();
    expect(r.counters).toBeGreaterThanOrEqual(1);
    expect(r.locks).toBeGreaterThanOrEqual(1);
    expect(r.events).toBeGreaterThanOrEqual(1);
    const left = await risk(u);
    expect(left).toMatchObject({ ip_hash: null, net_hash: null, device_hash: null, email_hash: null });
    expect(left.score).toEqual(expect.any(Number)); // a pontuação fica
    expect((await pool.query("SELECT 1 FROM security.events WHERE user_id = $1 AND created_at < now() - interval '90 days'", [u.id])).rowCount).toBe(0);
  });

  it('eliminar a conta apaga as impressões da segurança e desliga os eventos da conta', async () => {
    const u = await signup('del', { headers: { ...MOBILE, 'X-Install-Id': `del${run}bbbbbbbbbbbbbbbbb` } });
    await login(u.username, 'errada-errada-z', freshIp()).expect(401);
    await api().post('/api/v1/auth/delete-account').set(bearer(u)).send({ confirmUsername: u.username, password: PASSWORD }).expect(204);
    expect(await risk(u)).toMatchObject({ ip_hash: null, device_hash: null, email_hash: null });
    expect((await pool.query('SELECT 1 FROM security.events WHERE user_id = $1', [u.id])).rowCount).toBe(0);
  });
});
