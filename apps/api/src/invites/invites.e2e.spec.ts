import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { AnalyticsService } from '../analytics/analytics.service';
import { WELCOME_BONUS } from '../wallet/wallet.service';
import { ogCardSvg } from './card';
import { InvitesService, pickItems } from './invites.service';
import { INVITE } from './rules';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string; email: string }

describe('Convites: código, limites, espera e abuso (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: InvitesService;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string, opts: { code?: string; email?: string; old?: boolean; verified?: boolean; ip?: string } = {}): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const email = opts.email ?? `${username}@example.com`;
    // Cada pessoa vem de um «IP» diferente (senão o limite de registos por minuto trava o teste), menos quando o teste quer a mesma rede.
    const ip = opts.ip ?? `10.7.${Math.floor(n / 250)}.${(n % 250) + 1}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip).send({ email, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true, inviteCode: opts.code }).expect(201);
    const id = r.body.user.id as string;
    if (opts.verified !== false) await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [id]);
    if (opts.old) await pool.query("UPDATE identity.users SET created_at = now() - interval '5 days' WHERE id = $1", [id]);
    return { token: r.body.accessToken, id, username, email };
  }
  const balance = async (x: U) => Number((await api().get('/api/v1/wallet').set(auth(x)).expect(200)).body.balance);
  const post = (x: U) => api().post('/api/v1/posts').set(auth(x)).send({ body: 'olá malta', mediaIds: [] }).expect(201);
  const status = async (x: U) => (await pool.query('SELECT status, reason FROM social.referrals WHERE invitee_id = $1', [x.id])).rows[0] as { status: string; reason: string | null } | undefined;
  const settle = () => pool.query("UPDATE social.referrals SET release_at = now() - interval '1 minute' WHERE status = 'qualified'");
  /** A pessoa «voltou» ao Txillapp mais de 12 horas depois do registo (a sessão do registo passa a contar como regresso). */
  const returned = (x: U) => pool.query("UPDATE identity.users SET created_at = now() - interval '13 hours' WHERE id = $1", [x.id]);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    svc = app.get(InvitesService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o convidado só ganha quando fica ativo; quem convida só depois da espera; tudo uma só vez', async () => {
    const a = await signup('cva', { old: true });
    const me = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body;
    expect(me.code).toMatch(/^[A-Z2-9]{8}$/);
    // A ligação nova é /c/CÓDIGO (mostra o cartão na pré-visualização).
    expect(me.link).toContain(`/c/${me.code}`);
    expect(me.rules).toMatchObject({ reward: INVITE.REWARD, perDay: 5, maxPaid: 50, holdDays: 7 });
    // O mesmo código outra vez.
    expect((await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body.code).toBe(me.code);
    // Pré-visualização pública (também em minúsculas, como pode vir na ligação).
    expect((await api().get(`/api/v1/invites/preview/${me.code}`).expect(200)).body.username).toBe(a.username);
    expect((await api().get(`/api/v1/invites/preview/${me.code.toLowerCase()}`).expect(200)).body.username).toBe(a.username);
    await api().get('/api/v1/invites/preview/NAOEXISTE').expect(404);

    const before = await balance(a);
    const b = await signup('cvb', { code: me.code });
    await new Promise((r) => setTimeout(r, 200));
    expect((await status(b))?.status).toBe('registered');
    // Desde a 0148, ninguém ganha nada só por se registar: só o bónus de boas-vindas, para já…
    expect(await balance(b)).toBe(WELCOME_BONUS);
    // …e quem convidou é avisado logo («entrou com o teu convite»), mas o prémio dele ainda não chegou.
    const notes = (await api().get('/api/v1/notifications').set(auth(a)).expect(200)).body.items as { kind: string; actor: { username: string } }[];
    expect(notes.filter((x) => x.kind === 'invite_joined').map((x) => x.actor.username)).toEqual([b.username]);
    expect(await balance(a)).toBe(before);
    // Ainda não fez nada: nada mais acontece.
    await svc.sweep();
    expect((await status(b))?.status).toBe('registered');
    // Publica, mas ainda não voltou ao Txillapp noutra altura: ainda não é uma conta real.
    await post(b);
    await svc.sweep();
    expect((await status(b))?.status).toBe('registered');
    expect(await balance(b)).toBe(WELCOME_BONUS);
    // Voltou mais de 12 horas depois: conta real. Os Txills dela chegam agora (uma só vez); o convite fica em espera.
    await returned(b);
    await svc.sweep();
    await svc.sweep();
    expect(await balance(b)).toBe(WELCOME_BONUS + INVITE.REWARD);
    expect((await status(b))?.status).toBe('qualified');
    expect(await balance(a)).toBe(before);
    const mid = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body;
    expect(mid.stats).toMatchObject({ invited: 1, pending: 1, paid: 0 });
    // Depois da espera: quem convidou recebe, e só uma vez.
    await settle();
    await svc.sweep();
    expect(await balance(a)).toBe(before + INVITE.REWARD);
    expect((await status(b))?.status).toBe('paid');
    await svc.sweep(); // outra vez: nada muda
    expect(await balance(a)).toBe(before + INVITE.REWARD);
    const after = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body;
    expect(after.stats).toMatchObject({ invited: 1, paid: 1, earned: INVITE.REWARD });
  });

  it('sem email confirmado, ou com email temporário, ou com o código de si próprio: sem prémio', async () => {
    const a = await signup('cvc', { old: true });
    const code = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body.code as string;
    const nv = await signup('cvd', { code, verified: false });
    await post(nv).catch(() => undefined); // sem email confirmado nem sequer publica
    await new Promise((r) => setTimeout(r, 150));
    await svc.sweep();
    expect((await status(nv))?.status).toBe('registered'); // continua à espera
    // Email temporário: desde a 0148 nem sequer regista (e o convite não avisa quem convidou).
    const tmp = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.7.250.${n % 250}`)
      .send({ email: `x${run}${n}@mailinator.com`, username: `cve${run}${n++}`.slice(0, 28), displayName: 'cve Teste', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true, inviteCode: code }).expect(400);
    expect(tmp.body.code).toBe('disposable_email');
    const notes = (await api().get('/api/v1/notifications').set(auth(a)).expect(200)).body.items as { kind: string; actor: { username: string } }[];
    expect(notes.filter((x) => x.kind === 'invite_joined').map((x) => x.actor.username)).toEqual([nv.username]);
    // Código desconhecido: ignorado, o registo não falha.
    const x = await signup('cvf', { code: 'ZZZZZZZZ' });
    expect(await status(x)).toBeUndefined();
  });

  it('quem desligou os avisos de convites não recebe o «entrou com o teu convite» (mas o convite conta)', async () => {
    const a = await signup('cvo', { old: true });
    await api().put('/api/v1/notifications/settings').set(auth(a)).send({ off: ['invites'] }).expect(204);
    const code = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body.code as string;
    const b = await signup('cvp', { code });
    await new Promise((r) => setTimeout(r, 200));
    expect((await status(b))?.status).toBe('registered');
    expect(await balance(b)).toBe(WELCOME_BONUS);
    const notes = (await api().get('/api/v1/notifications').set(auth(a)).expect(200)).body.items as { kind: string }[];
    expect(notes.filter((x) => x.kind === 'invite_joined')).toHaveLength(0);
  });

  it('quem convida precisa de email confirmado e de mais de 3 dias; a mesma rede repetida deixa de ser premiada', async () => {
    const young = await signup('cvg');
    const code = (await api().get('/api/v1/invites/me').set(auth(young)).expect(200)).body;
    expect(code.eligible).toBe(false);
    expect(code.note).toContain('dias');
    const c = await signup('cvh', { code: code.code });
    await post(c);
    await new Promise((r) => setTimeout(r, 150));
    await svc.sweep();
    expect((await status(c))?.status).toBe('registered'); // quem convidou ainda é recente
    // Também sem os Txills do convite à entrada (chegam quando quem convidou puder convidar com prémio); o aviso chega na mesma.
    expect(await balance(c)).toBe(WELCOME_BONUS);
    const yn = (await api().get('/api/v1/notifications').set(auth(young)).expect(200)).body.items as { kind: string }[];
    expect(yn.some((x) => x.kind === 'invite_joined')).toBe(true);
    // Mesma rede: o 4.º registo em 24 h é marcado.
    const old = await signup('cvi', { old: true });
    const oc = (await api().get('/api/v1/invites/me').set(auth(old)).expect(200)).body.code as string;
    const rows: U[] = [];
    // Um IP público só desta corrida (os limites de registo por IP guardam-se na base de dados durante 24 h).
    const sameIp = `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
    for (let i = 0; i < INVITE.SAME_NET_MAX + 1; i++) rows.push(await signup(`cvn${i}`, { code: oc, ip: sameIp }));
    await new Promise((r) => setTimeout(r, 300));
    const statuses = await Promise.all(rows.map(status));
    expect(statuses.filter((s) => s?.reason === 'mesma rede').length).toBe(1);
  });

  it('limite por dia (5) e limite total (50): o convite funciona mas já sem prémio', async () => {
    const a = await signup('cvj', { old: true });
    const code = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body.code as string;
    // Cinco convidados já qualificados hoje (inseridos diretamente).
    for (let i = 0; i < INVITE.PER_DAY; i++) {
      const w = await signup(`cvw${i}`);
      await pool.query("INSERT INTO social.referrals (invitee_id, inviter_id, status, qualified_at, release_at) VALUES ($1, $2, 'qualified', now(), now() + interval '7 days')", [w.id, a.id]);
    }
    const late = await signup('cvk', { code });
    await post(late);
    await returned(late);
    await new Promise((r) => setTimeout(r, 150));
    await svc.sweep();
    expect((await status(late))?.status).toBe('registered'); // fica para amanhã
    // Passou o dia: já conta.
    await pool.query("UPDATE social.referrals SET qualified_at = now() - interval '2 days' WHERE inviter_id = $1 AND status = 'qualified'", [a.id]);
    await svc.sweep();
    expect((await status(late))?.status).toBe('qualified');
    // Teto total: com 50 já premiados, o seguinte fica sem prémio.
    const b = await signup('cvl', { old: true });
    const bcode = (await api().get('/api/v1/invites/me').set(auth(b)).expect(200)).body.code as string;
    // Contas de enchimento (sem convite), para o teste não depender de outros ficheiros já terem criado 50 contas na base.
    await pool.query(
      `INSERT INTO identity.users (id, email, username, display_name)
       SELECT gen_random_uuid(), 'cvz' || $1 || '-' || g || '@example.com', 'cvz' || $1 || g, 'Enchimento' FROM generate_series(1, $2) g`,
      [run, INVITE.MAX_PAID],
    );
    await pool.query(
      `INSERT INTO social.referrals (invitee_id, inviter_id, status, amount, qualified_at, paid_at)
       SELECT u.id, $1, 'paid', 100, now() - interval '9 days', now() - interval '2 days' FROM identity.users u WHERE u.id <> $1 AND NOT EXISTS (SELECT 1 FROM social.referrals r WHERE r.invitee_id = u.id) ORDER BY u.created_at DESC LIMIT $2`,
      [b.id, INVITE.MAX_PAID],
    );
    const over = await signup('cvm', { code: bcode });
    await post(over);
    await returned(over);
    await new Promise((r) => setTimeout(r, 150));
    await svc.sweep();
    expect(await status(over)).toMatchObject({ status: 'blocked', reason: 'limite total' });
  });

  describe('o cartão do convite e a página pública', () => {
    const item = async (name: string, kind: string, category: string, alcoholic = false, status = 'curated') => {
      const id = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id as string;
      await pool.query('INSERT INTO taste.items (id, slug, name, kind, category, alcoholic, status) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, `t-${run}-${n++}`, name, kind, category, alcoholic, status]);
      return id;
    };
    const keep = (u: U, itemId: string, favorite = false) => pool.query('INSERT INTO taste.user_items (user_id, item_id, favorite) VALUES ($1, $2, $3)', [u.id, itemId, favorite]);

    it('o cartão leva só a geleira pública; o álcool nunca sai a menores nem a quem não tem conta', async () => {
      const adult = await signup('cvq', { old: true });
      const beer = await item('2M gelada', 'bebida', 'cerveja', true);
      await keep(adult, beer, true);
      await keep(adult, await item('Matapa', 'comida', 'prato-tipico'));
      await keep(adult, await item('Praia', 'vibe', 'ar-livre'));
      await keep(adult, await item('Pendente', 'comida', 'rua', false, 'pending'));
      const me = (await api().get('/api/v1/invites/me').set(auth(adult)).expect(200)).body;
      expect(me.card).toMatchObject({ username: adult.username, hasAvatar: false, adult: true, geleiraPublic: true });
      expect(me.card).not.toHaveProperty('birthDate');
      expect((me.card.items as { name: string }[]).map((i) => i.name).sort()).toEqual(['2M gelada', 'Matapa', 'Praia']); // sem o pendente
      // Na página pública (sem conta), o álcool não sai.
      const pub = (await api().get(`/api/v1/invites/preview/${me.code}`).expect(200)).body;
      expect(pub).toMatchObject({ username: adult.username, displayName: 'cvq Teste', hasAvatar: false, reward: INVITE.REWARD });
      expect((pub.items as string[]).sort()).toEqual(['Matapa', 'Praia']);
      expect(Object.keys(pub).sort()).toEqual(['displayName', 'hasAvatar', 'items', 'phrase', 'reward', 'username', 'verified', 'verifiedTier']); // nada de email, id, datas…

      // Menor: nem no cartão dela aparece álcool (mesmo que o tivesse por algum motivo).
      const teen = await signup('cvr', { old: true });
      await pool.query("UPDATE identity.users SET birth_date = (now() - interval '16 years')::date WHERE id = $1", [teen.id]);
      await keep(teen, beer);
      await keep(teen, await item('Sumo de manga', 'bebida', 'sumo'));
      const tc = (await api().get('/api/v1/invites/me').set(auth(teen)).expect(200)).body.card;
      expect(tc.adult).toBe(false);
      expect((tc.items as { name: string; alcoholic: boolean }[]).map((i) => i.name)).toEqual(['Sumo de manga']);

      // Geleira só para seguidores, ou conta privada: o cartão vai sem geleira.
      await pool.query("UPDATE identity.users SET geleira_visibility = 'followers' WHERE id = $1", [adult.id]);
      const hidden = (await api().get('/api/v1/invites/me').set(auth(adult)).expect(200)).body.card;
      expect(hidden).toMatchObject({ geleiraPublic: false, items: [] });
      expect((await api().get(`/api/v1/invites/preview/${me.code}`).expect(200)).body.items).toEqual([]);
      await pool.query("UPDATE identity.users SET geleira_visibility = 'everyone', is_private = true WHERE id = $1", [adult.id]);
      expect((await api().get(`/api/v1/invites/preview/${me.code}`).expect(200)).body.items).toEqual([]);
    });

    it('a página dos robôs: «{Nome} convidou-te para o Txillapp» e o cartão em PNG; código desconhecido dá o genérico', async () => {
      const a = await signup('cvs', { old: true });
      await keep(a, await item('Xima', 'comida', 'prato-tipico'));
      const code = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body.code as string;
      const html = (await api().get(`/api/v1/invites/share/${code}`).set('Host', 'txillapp.com').expect(200)).text;
      expect(html).toContain('<meta property="og:title" content="cvs Teste convidou-te para o Txillapp">');
      expect(html).toContain(`<meta property="og:image" content="https://txillapp.com/api/v1/invites/card/${code}.png?v=2">`);
      expect(html).toContain(`<meta property="og:url" content="https://txillapp.com/c/${code}">`);
      expect(html).not.toContain(a.email);
      const png = await api().get(`/api/v1/invites/card/${code}.png`).buffer(true).parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      }).expect(200);
      expect(png.headers['content-type']).toContain('image/png');
      const body = png.body as Buffer;
      expect(body.subarray(1, 4).toString()).toBe('PNG');
      // Nomes com caracteres especiais não partem o HTML nem o SVG.
      await pool.query(`UPDATE identity.users SET display_name = 'Zé <b>"&' WHERE id = $1`, [a.id]);
      const html2 = (await api().get(`/api/v1/invites/share/${code}`).expect(200)).text;
      expect(html2).toContain('Zé &lt;b&gt;&quot;&amp; convidou-te');
      expect(ogCardSvg({ code, displayName: 'Zé <b>"&', items: ['A & B'], reward: 50, hasAvatar: false })).not.toMatch(/<b>|"&/);
      // Desconhecido: o genérico, sem dizer que não existe.
      const gen = (await api().get('/api/v1/invites/share/NAOEXISTE').expect(200)).text;
      expect(gen).toContain('Txillapp, a rede da malta');
      await api().get('/api/v1/invites/card/NAOEXISTE.png').expect(404);
    });

    it('pickItems: tipos diferentes primeiro, até ao máximo', () => {
      const rows = [{ kind: 'bebida', n: 1 }, { kind: 'bebida', n: 2 }, { kind: 'comida', n: 3 }, { kind: 'vibe', n: 4 }, { kind: 'comida', n: 5 }];
      expect(pickItems(rows, 3).map((r) => r.n)).toEqual([1, 3, 4]);
      expect(pickItems(rows, 4).map((r) => r.n)).toEqual([1, 3, 4, 2]);
      expect(pickItems([], 4)).toEqual([]);
    });

    it('a medição: as entradas por convite aparecem nas estatísticas e no resumo do backoffice', async () => {
      const stats = await app.get(AnalyticsService).stats(7);
      expect(stats.sources.invite.joined).toBeGreaterThanOrEqual(5);
      expect(stats.sources.invite.blocked).toBeGreaterThanOrEqual(1);
      expect(stats.series.inviteSignups.reduce((s, d) => s + d.value, 0)).toBeGreaterThanOrEqual(5);
    });
  });
});
