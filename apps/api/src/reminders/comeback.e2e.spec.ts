import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import webpush from 'web-push';
import { uuidv7 } from '../common/uuid7';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { MailService } from '../mail/mail.service';
import { createApp } from '../main';
import { ComebackReminderService } from './comeback-reminder.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PUBLIC = 'https://txillapp.com';
const DAY = 86_400_000;

interface U { token: string; id: string; username: string }
interface Sent { endpoint: string; payload: { title: string; body: string; url: string; tag?: string }; ttl?: number }

/**
 * Lembretes de regresso (ComebackReminderService, de hora a hora; migração 0129), com o tempo e os canais simulados:
 * - etapas aos 3/7/14/30/60 dias, o limite de um por semana (também entre ciclos), o fim aos 90 dias e o recomeço ao voltar;
 * - só das 9h00 às 19h59 de Maputo, com o push a perder a validade às 21h00;
 * - o interruptor nas Definições e o "Deixar de receber" por token, sem sessão;
 * - push primeiro e e-mail só sem push que chegue; nunca contas suspensas, apagadas ou de menores;
 * - o texto usa só o que existe para a pessoa e nunca nomes de quem está bloqueado nem o conteúdo das mensagens;
 * - idempotente (duas voltas ao mesmo tempo mandam um só lembrete), na exportação, no apagar conta e no backoffice.
 * O "agora" é passado ao run(): a última visita de cada conta é posta em `base` (10h00 de Maputo, há 200 dias).
 */
describe('lembretes de regresso (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: ComebackReminderService;
  let mail: MailService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const sent: Sent[] = [];
  const keys = webpush.generateVAPIDKeys();

  const b = new Date(Date.now() - 200 * DAY);
  b.setUTCHours(8, 0, 0, 0); // 10h00 em Maputo
  const base = b.getTime();
  /** `days` dias depois da última visita, à hora `hour` de Maputo. */
  const at = (days: number, hour = 10) => new Date(base + days * DAY + (hour - 10) * 3_600_000);

  let n = 0;
  async function signup(displayName = 'Pessoa Teste', o: { email?: boolean } = {}): Promise<U> {
    const username = `cb${n++}${run}`.slice(0, 28);
    // Muitas contas: cada uma "vem" de um IP diferente (o registo tem limite por IP).
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.77.${n >> 8}.${n & 255}`).send({ email: `${username}@example.com`, username, displayName, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    const u = { token: r.body.accessToken, id: r.body.user.id, username };
    if (o.email !== false) await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [u.id]);
    await away(u, at(0));
    return u;
  }
  /** A última visita passa a ser `when`. */
  async function away(u: U, when: Date) {
    await pool.query('UPDATE identity.users SET created_at = least(created_at, $2), last_seen_at = $2 WHERE id = $1', [u.id, when]);
    await pool.query('UPDATE identity.sessions SET created_at = $2, used_at = NULL WHERE user_id = $1', [u.id, when]);
  }
  const endpoint = (u: U, tag = 'ok') => `https://push.example.com/${run}/${u.username}/${tag}`;
  async function withPush(u: U, tag = 'ok') {
    await api().post('/api/v1/push/subscribe').set(auth(u)).send({ endpoint: endpoint(u, tag), keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } }).expect(204);
  }
  /** Os lembretes (etiqueta comeback) que chegaram aos aparelhos de `u` (as outras notificações ficam de fora). */
  const pushesTo = (u: U) => sent.filter((s) => s.endpoint.includes(`/${u.username}/`) && s.payload.tag === 'comeback');
  /** Os e-mails de lembrete (com List-Unsubscribe) para `u`; o de confirmar a conta, do registo, fica de fora. */
  const mailsTo = (u: U) => mail.outbox.filter((m) => m.to === `${u.username}@example.com` && !!m.headers?.['List-Unsubscribe']);
  const logOf = async (u: U) =>
    (await pool.query('SELECT stage, channel, kind, sent_at, cycle_at, returned_at FROM social.comeback_reminders WHERE user_id = $1 ORDER BY sent_at, stage', [u.id])).rows as {
      stage: number; channel: string; kind: string; sent_at: Date; cycle_at: Date; returned_at: Date | null;
    }[];
  const tick = (when: Date, ...us: U[]) => svc.run({ now: when, onlyUsers: us.map((x) => x.id) });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    jest.spyOn(webpush, 'sendNotification').mockImplementation(async (s, payload, opts) => {
      const ep = (s as { endpoint: string }).endpoint;
      if (ep.endsWith('/dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: ep, payload: JSON.parse(String(payload)), ttl: (opts as { TTL?: number } | undefined)?.TTL });
      return { statusCode: 201, body: '', headers: {} };
    });
    app = await createApp(
      loadConfig({
        DATABASE_URL: DB, JWT_ACCESS_SECRET: 'r'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', MAIL_CAPTURE: 'true', PUBLIC_URL: PUBLIC,
        VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey,
      }),
    );
    await app.init();
    svc = app.get(ComebackReminderService);
    mail = app.get(MailService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('etapas aos 3, 7, 14 e 30 dias (e 60), nunca mais de um por semana, e pára de vez aos 90 dias', async () => {
    const a = await signup();
    await withPush(a);
    expect((await tick(at(2, 18), a)).push).toBe(0); // ainda não fez 3 dias
    expect((await tick(at(3), a)).push).toBe(1);
    expect((await logOf(a)).map((r) => r.stage)).toEqual([1]);
    // Aos 7 dias a 2.ª etapa está pronta, mas a 1.ª saiu há só 4 dias: o limite semanal segura-a até aos 10.
    expect((await tick(at(7), a)).push).toBe(0);
    expect((await tick(at(9, 19), a)).push).toBe(0);
    expect((await tick(at(10), a)).push).toBe(1);
    expect((await tick(at(14), a)).push).toBe(0); // 3.ª pronta, mas só 4 dias depois da 2.ª
    expect((await tick(at(17), a)).push).toBe(1);
    expect((await tick(at(29), a)).push).toBe(0); // entre a 3.ª e a 4.ª não há nada
    expect((await tick(at(30), a)).push).toBe(1);
    expect((await tick(at(45), a)).push).toBe(0); // depois dos 30, no máximo um por mês
    expect((await tick(at(60), a)).push).toBe(1);
    expect((await tick(at(89), a)).push).toBe(0);
    expect((await tick(at(90), a)).push).toBe(0);
    expect((await tick(at(120), a)).push).toBe(0);
    expect((await logOf(a)).map((r) => r.stage)).toEqual([1, 2, 3, 4, 5]);
    expect((await logOf(a)).every((r) => r.channel === 'push')).toBe(true);

    // Quem só passou a ter por onde receber aos 7 dias recebe logo a etapa desses dias, e as seguintes nos dias certos.
    const b2 = await signup('Bruno Teste', { email: false });
    expect((await tick(at(3), b2)).push + (await tick(at(3), b2)).email).toBe(0); // sem push nem e-mail confirmado
    await withPush(b2);
    await tick(at(7), b2);
    await tick(at(14), b2);
    await tick(at(30), b2);
    const log = await logOf(b2);
    expect(log.map((r) => r.stage)).toEqual([2, 3, 4]);
    expect(log.map((r) => Math.round((r.sent_at.getTime() - base) / DAY))).toEqual([7, 14, 30]);

    // Aos 90 dias sem abrir já não se manda nada, nem a primeira.
    const c = await signup();
    await withPush(c);
    expect((await tick(at(90), c)).push).toBe(0);
    expect((await tick(at(100), c)).push).toBe(0);
    expect(await logOf(c)).toHaveLength(0);
  });

  it('ao voltar à app o contador recomeça, sem furar o limite semanal, e conta quem voltou nas 48 h', async () => {
    const d = await signup();
    await withPush(d);
    await tick(at(3), d);
    await away(d, at(4)); // voltou no dia seguinte ao lembrete
    await tick(at(4, 12), d); // a tarefa seguinte marca que voltou
    expect((await logOf(d))[0].returned_at).not.toBeNull();
    // 3 dias depois de voltar o ciclo novo estaria pronto, mas o último lembrete foi há só 4 dias.
    expect((await tick(at(7, 11), d)).push).toBe(0);
    expect((await tick(at(10), d)).push).toBe(1);
    const log = await logOf(d);
    expect(log.map((r) => r.stage)).toEqual([1, 1]); // de novo a 1.ª etapa
    expect(log[1].cycle_at.getTime()).toBe(at(4).getTime());
    expect(log[1].returned_at).toBeNull();
  });

  it('só das 9h00 às 19h59 de Maputo; o push perde a validade às 21h00', async () => {
    const e = await signup();
    await withPush(e);
    for (const h of [2, 5, 8, 20, 23]) {
      const r = await tick(at(4, h), e);
      expect(r.outsideHours).toBe(true);
      expect(r.push).toBe(0);
    }
    expect(await logOf(e)).toHaveLength(0);
    const r = await tick(at(4, 9), e);
    expect(r.outsideHours).toBe(false);
    expect(r.push).toBe(1);
    const p = pushesTo(e)[0];
    expect(p.ttl).toBe(12 * 3600); // das 9h00 às 21h00
    expect(p.payload.tag).toBe('comeback');

    const e2 = await signup();
    await withPush(e2);
    await tick(at(4, 19), e2);
    expect(pushesTo(e2)[0].ttl).toBe(2 * 3600);
  });

  it('desligar nas Definições: o interruptor existe, vem ligado e, desligado, não chega nada', async () => {
    const f = await signup();
    await withPush(f);
    const s = (await api().get('/api/v1/notifications/settings').set(auth(f)).expect(200)).body;
    expect(s.categories).toContain('comeback');
    expect(s.off).not.toContain('comeback');
    await api().put('/api/v1/notifications/settings').set(auth(f)).send({ off: ['comeback'] }).expect(204);
    expect((await tick(at(3), f)).push).toBe(0);
    expect(mailsTo(f)).toHaveLength(0);
    expect(await logOf(f)).toHaveLength(0);
    // Voltar a ligar: recebe.
    await api().put('/api/v1/notifications/settings').set(auth(f)).send({ off: [] }).expect(204);
    expect((await tick(at(3, 11), f)).push).toBe(1);
  });

  it('nunca a contas suspensas, apagadas ou de menores', async () => {
    const sus = await signup();
    const del = await signup();
    const minor = await signup();
    const noBirth = await signup();
    for (const x of [sus, del, minor, noBirth]) await withPush(x);
    await pool.query("UPDATE identity.users SET status = 'suspended' WHERE id = $1", [sus.id]);
    await pool.query("UPDATE identity.users SET status = 'deleted' WHERE id = $1", [del.id]);
    await pool.query("UPDATE identity.users SET birth_date = (now() - interval '15 years')::date WHERE id = $1", [minor.id]);
    await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [noBirth.id]);
    const r = await tick(at(3), sus, del, minor, noBirth);
    expect(r.push + r.email).toBe(0);
    for (const x of [sus, del, minor, noBirth]) expect(await logOf(x)).toHaveLength(0);
  });

  it('push primeiro; e-mail só sem push que chegue, com "Deixar de receber" por token de um clique, sem sessão', async () => {
    const g = await signup();
    await withPush(g);
    const h = await signup('Helena Teste');
    const i = await signup();
    await withPush(i, 'dead'); // a subscrição já morreu (410): passa ao e-mail
    const r = await tick(at(3), g, h, i);
    expect(r).toMatchObject({ push: 1, email: 2 });
    expect(pushesTo(g)).toHaveLength(1);
    expect(mailsTo(g)).toHaveLength(0);
    expect((await logOf(g))[0].channel).toBe('push');
    expect((await logOf(h))[0].channel).toBe('email');
    expect((await logOf(i))[0].channel).toBe('email');
    expect((await pool.query('SELECT count(*)::int AS n FROM social.push_subscriptions WHERE user_id = $1', [i.id])).rows[0].n).toBe(0);

    const m = mailsTo(h)[0];
    expect(m.subject).toBeTruthy();
    expect(m.text).toContain('Olá, Helena!');
    expect(m.text).toContain('Deixar de receber estes lembretes');
    expect(m.html).toContain('Deixar de receber estes lembretes');
    const link = /Deixar de receber estes lembretes: (\S+)/.exec(m.text)![1];
    expect(link.startsWith(`${PUBLIC}/api/v1/comeback/unsubscribe?token=`)).toBe(true);
    expect(m.headers?.['List-Unsubscribe']).toBe(`<${link}>`);
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const path = link.slice(PUBLIC.length);

    // Um token mexido não serve e não muda nada.
    const bad = path.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await api().get(bad).expect(200)).text).toContain('não serve');
    expect((await api().get('/api/v1/comeback/unsubscribe').expect(200)).text).toContain('não serve');
    // A ligação certa, sem sessão nenhuma: desliga.
    const ok = await api().get(path).expect(200);
    expect(ok.headers['content-type']).toMatch(/text\/html/);
    expect(ok.text).toContain('Pronto');
    await api().get(path).expect(200); // repetir não estraga
    const s = (await api().get('/api/v1/notifications/settings').set(auth(h)).expect(200)).body;
    expect(s.off).toEqual(['comeback']);
    expect((await tick(at(10), h)).email).toBe(0);

    // O botão "Cancelar subscrição" do Gmail/Outlook (POST de um clique), mantendo o que já estava desligado.
    await api().put('/api/v1/notifications/settings').set(auth(i)).send({ off: ['follows'] }).expect(204);
    const linkI = /Deixar de receber estes lembretes: (\S+)/.exec(mailsTo(i)[0].text)![1].slice(PUBLIC.length);
    expect((await api().post(linkI).type('form').send('List-Unsubscribe=One-Click').expect(200)).body).toEqual({ ok: true });
    expect((await api().get('/api/v1/notifications/settings').set(auth(i)).expect(200)).body.off.sort()).toEqual(['comeback', 'follows']);
  });

  it('o texto usa só o que existe para a pessoa, nunca nomes de bloqueados nem o conteúdo, e o toque abre o sítio certo', async () => {
    const ana = await signup('Ana Maria');
    const bia = await signup('Bia Teste');
    const reader = await signup();
    await withPush(reader);
    for (const x of [ana, bia]) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2)', [reader.id, x.id]);
    await pool.query("UPDATE identity.users SET gender = 'female', show_gender = true WHERE id = $1", [ana.id]);
    // Publicaram depois da última visita (a Bia por último), mas a pessoa bloqueou a Bia (o seguir ficou lá, de propósito).
    await pool.query("INSERT INTO content.posts (id, author_id, body) VALUES ($1, $2, 'olá malta')", [uuidv7(), ana.id]);
    await pool.query("INSERT INTO content.posts (id, author_id, body) VALUES ($1, $2, 'segredo da bia')", [uuidv7(Date.now() + 1000), bia.id]);
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [reader.id, bia.id]);
    await tick(at(3), reader);
    const p = pushesTo(reader)[0].payload;
    expect(p.body).toBe('A Ana publicou desde a tua última visita.');
    expect(p.url).toBe('/');
    expect(JSON.stringify(p)).not.toMatch(/Bia|segredo|olá malta/);
    expect((await logOf(reader))[0].kind).toBe('posts');

    // Mensagens por ler (de quem a pessoa segue): o número, nunca o texto; abre as mensagens.
    const chatty = await signup();
    await withPush(chatty);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1)', [chatty.id, ana.id]);
    for (const t of ['a minha senha é 1234', 'responde', 'olá?']) await api().post(`/api/v1/chat/with/${chatty.username}`).set(auth(ana)).send({ body: t }).expect(201);
    await tick(at(3), chatty);
    const pm = pushesTo(chatty)[0].payload;
    expect(pm.body).toBe('Tens 3 mensagens por ler.');
    expect(pm.url).toBe('/messages');
    expect(JSON.stringify(pm)).not.toMatch(/1234|senha|Ana/);

    // Brindes na minha publicação, sem contar os de quem eu bloqueei; abre a publicação.
    const owner = await signup();
    await withPush(owner);
    const post = uuidv7();
    await pool.query("INSERT INTO content.posts (id, author_id, body) VALUES ($1, $2, 'a minha')", [post, owner.id]);
    for (const x of [ana, bia, reader]) await pool.query('INSERT INTO content.cheers (post_id, user_id) VALUES ($1, $2)', [post, x.id]);
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [owner.id, bia.id]);
    await tick(at(3), owner);
    const pc = pushesTo(owner)[0].payload;
    expect(pc.body).toBe('A tua publicação recebeu 2 brindes.');
    expect(pc.url).toBe(`/p/${post}`);

    // Mimos novos de quem segue (os que a pessoa pode ver: não os só para amigos próximos de outros).
    const fan = await signup();
    await withPush(fan);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2)', [fan.id, ana.id]);
    for (const audience of ['all', 'all', 'close_friends']) {
      const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status) VALUES (gen_random_uuid(), $1, 'image/png', 1, 'x', 'ready') RETURNING id`, [ana.id])).rows[0].id;
      await pool.query('INSERT INTO content.stories (id, author_id, media_id, audience) VALUES ($1, $2, $3, $4)', [uuidv7(), ana.id, media, audience]);
    }
    await pool.query('UPDATE content.posts SET removed_at = now() WHERE author_id = $1', [ana.id]); // só os mimos contam aqui
    await tick(at(3), fan);
    const ps = pushesTo(fan)[0].payload;
    expect(ps.body).toBe('Há 2 mimos novos de quem segues.');
    expect(ps.url).toBe('/');

    // Sem nada: o texto simpático.
    const quiet = await signup();
    await withPush(quiet);
    await tick(at(3), quiet);
    expect(pushesTo(quiet)[0].payload).toMatchObject({ body: 'A malta anda por aqui. Bora ver o que se passa?', url: '/' });
    expect((await logOf(quiet))[0].kind).toBe('generic');
    // O lembrete seguinte já diz outra coisa.
    await tick(at(10), quiet);
    expect(pushesTo(quiet)[1].payload.body).not.toBe(pushesTo(quiet)[0].payload.body);
  });

  it('idempotente: duas voltas ao mesmo tempo (ou repetidas) mandam um só lembrete', async () => {
    const v = await signup();
    await withPush(v);
    const rs = await Promise.all([tick(at(3), v), tick(at(3), v), tick(at(3), v)]);
    expect(rs.reduce((s, r) => s + r.push, 0)).toBe(1);
    await tick(at(3, 11), v);
    await tick(at(4), v);
    expect(pushesTo(v)).toHaveLength(1);
    expect(await logOf(v)).toHaveLength(1);
  });

  it('a exportação traz os lembretes; apagar a conta apaga o registo; o backoffice só vê números', async () => {
    const w = await signup();
    await withPush(w);
    await tick(at(3), w);
    const exp = JSON.parse((await api().get('/api/v1/me/export').set(auth(w)).expect(200)).text);
    expect(exp.comebackReminders.remindersOn).toBe(true);
    expect(exp.comebackReminders.sent).toHaveLength(1);
    expect(exp.comebackReminders.sent[0]).toMatchObject({ stage: 1, channel: 'push', kind: 'generic' });

    // Backoffice: só para a equipa.
    await api().get('/api/v1/admin/growth/comeback').set(auth(w)).expect((r) => expect([401, 403]).toContain(r.status));
    const st = await svc.stats(7, at(9));
    const all = (await pool.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE channel = 'email')::int AS email, count(*) FILTER (WHERE returned_at <= sent_at + interval '48 hours')::int AS back
         FROM social.comeback_reminders WHERE channel <> 'pending' AND sent_at > $1 AND sent_at <= $2`,
      [new Date(at(9).getTime() - 7 * DAY), at(9)],
    )).rows[0];
    expect(st.totals.sent).toBe(all.n);
    expect(st.totals.returned).toBe(all.back);
    expect(st.totals.returned).toBeGreaterThanOrEqual(1); // quem voltou no teste do recomeço
    expect(st.series).toHaveLength(7);
    expect(st.series.reduce((s, d) => s + d.push + d.email, 0)).toBe(all.n);
    expect(st.byChannel.find((c) => c.channel === 'email')!.sent).toBe(all.email);
    expect(st.byStage.map((s) => s.afterDays)).toEqual([3, 7, 14, 30, 60]);
    expect(st.byStage.reduce((s, x) => s + x.sent, 0)).toBe(all.n);
    expect(JSON.stringify(st)).not.toMatch(/username|user_id|@/);

    await api().post('/api/v1/auth/delete-account').set(auth(w)).send({ confirmUsername: w.username, password: PASSWORD }).expect(204);
    expect(await logOf(w)).toHaveLength(0);
  });
});
