import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService, type PushPayload } from '../push/push.service';
import { staffLogin } from '../staff/staff-test';
import type { LiveKitRooms } from './livekit';
import { TxilladaSchedulesService } from './txillada-schedules.service';
import { whenLabel } from './txillada-when';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };
const MIN = 60_000;
const HOUR = 60 * MIN;

interface U { token: string; id: string; username: string; ip: string }

/**
 * Txillada agendada (0176), docs/txillada-agendar.md: agendar (limites de hora, 5 no máximo, 30 min entre elas, os tipos), quem
 * vê, «Lembrar-me», editar e cancelar (com os avisos), começar a partir do agendamento (e a ligação automática), os avisos ao
 * anfitrião, expirar e limpar, o perfil e a conta. Sem o servidor LiveKit e com os pushes guardados em vez de enviados.
 */
describe('Txillada agendada (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaSchedulesService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const pushes: { userId: string; p: PushPayload }[] = [];
  const rooms: LiveKitRooms = {
    removeParticipant: async () => undefined,
    deleteRoom: async () => undefined,
    participants: async () => [],
    setCanPublish: async () => undefined,
  };
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.176.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
  const schedule = (x: U, body: Record<string, unknown>) =>
    api().post('/api/v1/txilladas/schedules').set(auth(x)).send({ title: 'Conversa', audience: 'everyone', ...body });
  const get = (x: U, id: string) => api().get(`/api/v1/txilladas/schedules/${id}`).set(auth(x));
  const patch = (x: U, id: string, body: Record<string, unknown>) => api().patch(`/api/v1/txilladas/schedules/${id}`).set(auth(x)).send(body);
  const cancel = (x: U, id: string) => api().delete(`/api/v1/txilladas/schedules/${id}`).set(auth(x));
  const remind = (x: U, id: string) => api().post(`/api/v1/txilladas/schedules/${id}/remind`).set(auth(x));
  const unremind = (x: U, id: string) => api().delete(`/api/v1/txilladas/schedules/${id}/remind`).set(auth(x));
  const open = (x: U, body: Record<string, unknown> = {}) => api().post('/api/v1/txilladas').set(auth(x)).send(body);
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);
  const clear = (x: U) => pool.query(`DELETE FROM content.txillada_schedules WHERE host_id = $1`, [x.id]);
  const notes = async (x: U, kind: string) =>
    (await pool.query(`SELECT actor_id, data FROM social.notifications WHERE user_id = $1 AND kind = $2 ORDER BY id`, [x.id, kind])).rows as { actor_id: string; data: any }[];
  const lives = async (x: U, txId: string) =>
    (await pool.query(`SELECT data FROM social.notifications WHERE user_id = $1 AND kind = 'txillada_live' AND data->>'txilladaId' = $2 ORDER BY id`, [x.id, txId])).rows.map((r) => r.data);
  const srow = async (id: string) => (await pool.query('SELECT * FROM content.txillada_schedules WHERE id = $1', [id])).rows[0];
  async function until(f: () => Promise<boolean>) {
    for (let i = 0; i < 100 && !(await f()); i++) await new Promise((r) => setTimeout(r, 20));
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...LK }),
      { livekitRooms: rooms },
    );
    await app.init();
    svc = app.get(TxilladaSchedulesService);
    // A base é só dos testes: os agendamentos de corridas antigas não contam nas tarefas (que olham para todos).
    await pool.query('DELETE FROM content.txillada_schedules');
    const push = app.get(PushService);
    Object.defineProperty(push, 'enabled', { value: true });
    jest.spyOn(push, 'send').mockImplementation(async (userId: string, p: PushPayload) => {
      pushes.push({ userId, p });
      return 1;
    });
    for (const name of ['host', 'ana', 'rui', 'eva', 'kid', 'blk', 'priv', 'h2', 'h3', 'fan', 'gone', 'spam', 'h4', 'den', 'off', 'sus']) u[name] = await signup(name);
    const { host, ana, rui, eva, blk, h2, h3, fan } = u;
    // A Ana e o anfitrião seguem-se (amigos); a Eva só segue o anfitrião; o Rui não segue ninguém.
    await follow(ana, host);
    await follow(host, ana);
    await follow(eva, host);
    await follow(fan, h2);
    await follow(ana, h2);
    await follow(ana, h3);
    await follow(fan, h3);
    await pool.query(`UPDATE identity.users SET birth_date = current_date - interval '16 years' WHERE id = $1`, [u.kid.id]);
    await api().put(`/api/v1/blocks/${blk.username}`).set(auth(host)).expect((r) => expect([200, 204]).toContain(r.status));
    void rui;
  }, 240_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('agendar: horas fora dos limites, quem pode, tipos, preço e meta, too_close e too_many', async () => {
    const { host, kid } = u;
    // Hora: pelo menos 15 min à frente e no máximo 30 dias.
    expect((await schedule(host, { startsAt: ahead(10 * MIN) }).expect(400)).body.message).toBe('Agenda a Txillada com pelo menos 15 minutos de antecedência.');
    expect((await schedule(host, { startsAt: ahead(31 * 24 * HOUR) }).expect(400)).body.message).toBe('Só podes agendar uma Txillada até 30 dias à frente.');
    await schedule(host, { startsAt: 'amanhã' }).expect(400);
    // Quem pode abrir: menor de 18 não.
    expect((await schedule(kid, { startsAt: ahead(2 * HOUR) }).expect(403)).body.message).toBe('A Txillada é só para maiores de 18 anos.');
    // Tipos, preço e meta como no POST /txilladas.
    await schedule(host, { audience: 'followers', startsAt: ahead(2 * HOUR) }).expect(400);
    await schedule(host, { audience: 'paid', startsAt: ahead(2 * HOUR) }).expect(400);
    await schedule(host, { audience: 'paid', price: 3, startsAt: ahead(2 * HOUR) }).expect(400);
    await schedule(host, { goal: 5, startsAt: ahead(2 * HOUR) }).expect(400);
    await schedule(host, { title: 'x'.repeat(81), startsAt: ahead(2 * HOUR) }).expect(400);

    const at = ahead(2 * HOUR);
    const s = (await schedule(host, { title: '  Bora   falar ', audience: 'paid', price: 50, goal: 1000, goalPurpose: 'Livros', startsAt: at }).expect(201)).body;
    expect(s).toMatchObject({
      host: { id: host.id, username: host.username, verified: false },
      title: 'Bora falar', audience: 'paid', kind: 'paid', price: 50, goal: 1000, goalPurpose: 'Livros', status: 'scheduled',
      txilladaId: null, live: false, isHost: true, reminded: false, reminders: 0,
    });
    expect(s.startsAt).toBe(new Date(at).toISOString());
    // Preço ignorado fora das pagas; motivo sem meta fica vazio.
    const pub = (await schedule(host, { price: 50, goalPurpose: 'nada', startsAt: ahead(4 * HOUR) }).expect(201)).body;
    expect(pub).toMatchObject({ kind: 'public', price: null, goal: null, goalPurpose: '' });

    // A menos de 30 minutos de outro: too_close.
    expect((await schedule(host, { startsAt: ahead(2 * HOUR + 20 * MIN) }).expect(409)).body).toMatchObject({ code: 'too_close' });
    // No máximo 5 à espera.
    for (let i = 0; i < 3; i++) await schedule(host, { startsAt: ahead((6 + i) * HOUR) }).expect(201);
    expect((await schedule(host, { startsAt: ahead(12 * HOUR) }).expect(409)).body).toMatchObject({ code: 'too_many' });
    // Um cancelado já não conta.
    await cancel(host, pub.id).expect(204);
    await schedule(host, { startsAt: ahead(12 * HOUR) }).expect(201);
    // Os meus, por hora.
    const mine = (await api().get('/api/v1/txilladas/schedules').set(auth(host)).expect(200)).body.items as { id: string; startsAt: string }[];
    expect(mine).toHaveLength(5);
    expect(mine[0].id).toBe(s.id);
    expect([...mine].sort((a, b) => a.startsAt.localeCompare(b.startsAt))).toEqual(mine);
    await clear(host);
  });

  it('quem vê: público, paga com o cartão, amigos, amigos próximos, conta privada, bloqueio; listas e «Em breve»', async () => {
    const { host, ana, rui, eva, blk, priv } = u;
    const pub = (await schedule(host, { startsAt: ahead(3 * HOUR) }).expect(201)).body.id as string;
    const paid = (await schedule(host, { audience: 'paid', price: 20, startsAt: ahead(5 * HOUR) }).expect(201)).body.id as string;
    const fr = (await schedule(host, { audience: 'friends', startsAt: ahead(7 * HOUR) }).expect(201)).body.id as string;
    const cl = (await schedule(host, { audience: 'close', startsAt: ahead(9 * HOUR) }).expect(201)).body.id as string;
    const far = (await schedule(host, { startsAt: ahead(3 * 24 * HOUR) }).expect(201)).body.id as string;

    expect((await get(rui, pub).expect(200)).body).toMatchObject({ isHost: false, reminders: null, reminded: false });
    // A paga: o cartão com o preço a quem pode ver o perfil.
    expect((await get(rui, paid).expect(200)).body).toMatchObject({ kind: 'paid', price: 20 });
    // Para amigos: só a Ana (segue e é seguida); a Eva só segue.
    await get(ana, fr).expect(200);
    await get(eva, fr).expect(404);
    await get(rui, fr).expect(404);
    // Só amigos próximos: a lista dos mimos.
    await get(ana, cl).expect(404);
    await api().put(`/api/v1/stories/close-friends/${eva.username}`).set(auth(host)).expect(204);
    await get(eva, cl).expect(200);
    // Bloqueio: 404 em tudo.
    await get(blk, pub).expect(404);
    await remind(blk, pub).expect(404);
    expect((await api().get(`/api/v1/txilladas/schedules?username=${host.username}`).set(auth(blk)).expect(200)).body.items).toEqual([]);
    // As listas: só o que cada um pode ver, por hora.
    const forRui = (await api().get(`/api/v1/txilladas/schedules?username=${host.username}`).set(auth(rui)).expect(200)).body.items.map((x: any) => x.id);
    expect(forRui).toEqual([pub, paid, far]);
    const forAna = (await api().get(`/api/v1/txilladas/schedules?username=@${host.username.toUpperCase()}`).set(auth(ana)).expect(200)).body.items.map((x: any) => x.id);
    expect(forAna).toEqual([pub, paid, fr, far]);
    await api().get('/api/v1/txilladas/schedules?username=naoexiste_zz').set(auth(ana)).expect(404);
    // «Em breve»: de quem sigo, nas próximas 48 h (a de daqui a 3 dias não; o Rui não segue o anfitrião).
    const up = (await api().get('/api/v1/txilladas/schedules/upcoming').set(auth(ana)).expect(200)).body.items.map((x: any) => x.id);
    expect(up).toEqual(expect.arrayContaining([pub, paid, fr]));
    expect(up).not.toContain(far);
    expect(up).not.toContain(cl);
    expect((await api().get('/api/v1/txilladas/schedules/upcoming').set(auth(rui)).expect(200)).body.items.map((x: any) => x.id)).not.toContain(pub);
    // Conta privada: só quem segue.
    const pv = (await schedule(priv, { startsAt: ahead(3 * HOUR) }).expect(201)).body.id as string;
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [priv.id]);
    await get(rui, pv).expect(404);
    await get(priv, pv).expect(200);
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [priv.id]);
    await get(rui, pv).expect(200);
    // Um id que não existe.
    await get(ana, '00000000-0000-7000-8000-000000000000').expect(404);
    await clear(host);
    await clear(priv);
  });

  it('lembrar-me e tirar: quem vê pede, o anfitrião vê quantos, não pode pedir; limite por minuto', async () => {
    const { host, ana, eva, rui, spam } = u;
    const id = (await schedule(host, { audience: 'friends', startsAt: ahead(3 * HOUR) }).expect(201)).body.id as string;
    expect((await remind(ana, id).expect(200)).body).toEqual({ reminded: true, reminders: null });
    await remind(ana, id).expect(200); // outra vez não repete
    expect((await get(ana, id).expect(200)).body).toMatchObject({ reminded: true, reminders: null });
    expect((await get(host, id).expect(200)).body).toMatchObject({ reminded: false, reminders: 1 });
    expect((await remind(host, id).expect(400)).body.message).toBe('Não precisas de lembrete na tua própria Txillada.');
    await remind(eva, id).expect(404); // não a pode ver
    await unremind(rui, id).expect(404);
    expect((await unremind(ana, id).expect(200)).body).toEqual({ reminded: false, reminders: null });
    expect((await get(host, id).expect(200)).body.reminders).toBe(0);
    // No máximo 60 por minuto (pedir e tirar juntos).
    const pub = (await schedule(host, { startsAt: ahead(5 * HOUR) }).expect(201)).body.id as string;
    let last = 0;
    for (let i = 0; i < 61; i++) last = (i % 2 ? await unremind(spam, pub) : await remind(spam, pub)).status;
    expect(last).toBe(429);
    await clear(host);
  });

  it('editar: título e hora com as mesmas regras; mudar a hora mais de 15 min avisa quem pediu lembrete; os avisos ao anfitrião voltam', async () => {
    const { host, ana, eva } = u;
    const at = new Date(Date.now() + 3 * HOUR);
    const s = (await schedule(host, { audience: 'paid', price: 10, startsAt: at.toISOString() }).expect(201)).body;
    await remind(ana, s.id).expect(200);
    await pool.query('UPDATE content.txillada_schedules SET host_reminded_at = now() WHERE id = $1', [s.id]);
    await patch(ana, s.id, { title: 'meu' }).expect(403);
    await patch(eva, '00000000-0000-7000-8000-000000000000', { title: 'x' }).expect(404);
    await patch(host, s.id, {}).expect(400);
    await patch(host, s.id, { startsAt: ahead(5 * MIN) }).expect(400);
    // O tipo e o preço não mudam (o corpo só aceita o título e a hora).
    const t = (await patch(host, s.id, { title: 'Novo título', audience: 'everyone', price: 99 }).expect(200)).body;
    expect(t).toMatchObject({ title: 'Novo título', audience: 'paid', price: 10 });
    // 10 minutos: sem aviso.
    pushes.length = 0;
    await patch(host, s.id, { startsAt: new Date(at.getTime() + 10 * MIN).toISOString() }).expect(200);
    expect((await srow(s.id)).host_reminded_at).toBeNull();
    // Mais de 15 minutos: aviso de mudança, com a hora nova.
    const to = new Date(at.getTime() + 26 * HOUR);
    await patch(host, s.id, { startsAt: to.toISOString() }).expect(200);
    await until(async () => (await notes(ana, 'txillada_scheduled_cancelled')).length > 0);
    await new Promise((r) => setTimeout(r, 100));
    const ns = await notes(ana, 'txillada_scheduled_cancelled');
    expect(ns).toHaveLength(1);
    expect(ns[0].actor_id).toBe(host.id);
    expect(ns[0].data).toEqual({
      scheduleId: s.id, title: 'Novo título', moved: true,
      startsAt: new Date(at.getTime() + 10 * MIN).toISOString(), newStartsAt: to.toISOString(),
    });
    await until(async () => pushes.some((p) => p.userId === ana.id));
    expect(pushes.find((p) => p.userId === ana.id)?.p).toMatchObject({
      body: `@${host.username} mudou a Txillada para ${whenLabel(to)}`, url: `/txillada/agendada/${s.id}`, category: 'txilladas',
    });
    // Começar agora mesmo assim: a hora passa a agora, sem aviso de mudança nem avisos ao anfitrião.
    const nowed = (await patch(host, s.id, { startsAt: new Date().toISOString() }).expect(200)).body;
    expect(Math.abs(new Date(nowed.startsAt).getTime() - Date.now())).toBeLessThan(5_000);
    expect(await svc.hostSoon()).toBe(0);
    expect(await svc.hostNow()).toBe(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(await notes(ana, 'txillada_scheduled_cancelled')).toHaveLength(1);
    // Fora de 'scheduled': 409.
    await cancel(host, s.id).expect(204);
    expect((await patch(host, s.id, { title: 'x' }).expect(409)).body).toMatchObject({ code: 'not_scheduled' });
    await clear(host);
    await pool.query(`DELETE FROM social.notifications WHERE user_id = $1`, [ana.id]);
  });

  it('cancelar: o anfitrião cancela, quem pediu lembrete é avisado; o cartão diz o que aconteceu', async () => {
    const { host, ana, rui } = u;
    const at = new Date(Date.now() + 4 * HOUR);
    const id = (await schedule(host, { title: 'Sábado', startsAt: at.toISOString() }).expect(201)).body.id as string;
    await remind(ana, id).expect(200);
    await remind(rui, id).expect(200);
    await cancel(ana, id).expect(403);
    pushes.length = 0;
    await cancel(host, id).expect(204);
    await cancel(host, id).expect(204); // outra vez não faz nada
    await until(async () => (await notes(rui, 'txillada_scheduled_cancelled')).length > 0 && (await notes(ana, 'txillada_scheduled_cancelled')).length > 0);
    expect((await notes(ana, 'txillada_scheduled_cancelled'))[0].data).toEqual({ scheduleId: id, startsAt: at.toISOString(), title: 'Sábado', moved: false });
    await until(async () => pushes.some((p) => p.userId === rui.id));
    expect(pushes.find((p) => p.userId === rui.id)?.p.body).toBe(`@${host.username} cancelou a Txillada de ${whenLabel(at)}`);
    expect((await get(rui, id).expect(200)).body).toMatchObject({ status: 'cancelled', txilladaId: null, live: false });
    expect((await remind(rui, id).expect(409)).body).toMatchObject({ code: 'not_scheduled' });
    // Já não aparece nas listas.
    expect((await api().get(`/api/v1/txilladas/schedules?username=${host.username}`).set(auth(rui)).expect(200)).body.items).toEqual([]);
    await clear(host);
  });

  it('começar com scheduleId: too_early; usa as escolhas do agendamento; liga; avisa os lembretes sem duplicar e sem o limite de 1/h', async () => {
    const { h2, ana, fan, rui, eva } = u;
    // fan e ana seguem h2; ana e rui pedem lembrete; eva não segue nem pede.
    const early = (await schedule(h2, { startsAt: ahead(3 * HOUR) }).expect(201)).body.id as string;
    expect((await open(h2, { scheduleId: early }).expect(409)).body).toMatchObject({ code: 'too_early', message: 'Só podes começar a partir de 1 hora antes da hora marcada.' });
    await open(ana, { scheduleId: early }).expect(403);
    await clear(h2);

    const s = (await schedule(h2, { title: 'Da agenda', audience: 'paid', price: 30, goal: 500, goalPurpose: 'Escola', startsAt: ahead(40 * MIN) }).expect(201)).body;
    await remind(ana, s.id).expect(200);
    await remind(rui, s.id).expect(200);
    pushes.length = 0;
    const tx = (await open(h2, { scheduleId: s.id, audience: 'everyone', price: null }).expect(201)).body.txillada;
    expect(tx).toMatchObject({ title: 'Da agenda', audience: 'paid', kind: 'paid', price: 30, goal: 500, goalPurpose: 'Escola' });
    expect(await srow(s.id)).toMatchObject({ status: 'started', txillada_id: tx.id });
    expect((await get(rui, s.id).expect(200)).body).toMatchObject({ status: 'started', txilladaId: tx.id, live: true });
    // Os lembretes recebem o txillada_live com scheduleId; a Ana (que também segue) só uma vez; o fan recebe o de sempre.
    await until(async () => (await lives(fan, tx.id)).length > 0 && (await lives(rui, tx.id)).length > 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(await lives(ana, tx.id)).toEqual([{ txilladaId: tx.id, title: 'Da agenda', scheduleId: s.id, reminded: true }]);
    expect(await lives(rui, tx.id)).toEqual([{ txilladaId: tx.id, title: 'Da agenda', scheduleId: s.id, reminded: true }]);
    expect(await lives(fan, tx.id)).toEqual([{ txilladaId: tx.id, title: 'Da agenda' }]);
    expect(await lives(eva, tx.id)).toEqual([]);
    expect(pushes.filter((p) => p.userId === ana.id)).toHaveLength(1);
    expect(pushes.find((p) => p.userId === rui.id)?.p).toMatchObject({ body: `@${h2.username} começou a Txillada que pediste para lembrar: Da agenda`, url: `/txillada/${tx.id}` });
    // Já começou: não se começa outra vez.
    await endAll(h2);
    expect((await open(h2, { scheduleId: s.id }).expect(409)).body).toMatchObject({ code: 'not_scheduled' });
    expect((await get(rui, s.id).expect(200)).body).toMatchObject({ status: 'started', live: false });

    // Logo a seguir (o anfitrião já avisou os seguidores nesta hora): quem pediu lembrete recebe na mesma; os seguidores não.
    const s2 = (await schedule(h2, { title: 'Outra', startsAt: ahead(50 * MIN) }).expect(201)).body.id as string;
    await remind(rui, s2).expect(200);
    const tx2 = (await open(h2, { scheduleId: s2, title: 'Título novo' }).expect(201)).body.txillada;
    expect(tx2.title).toBe('Título novo');
    await until(async () => (await lives(rui, tx2.id)).length > 0);
    await new Promise((r) => setTimeout(r, 150));
    expect(await lives(rui, tx2.id)).toEqual([{ txilladaId: tx2.id, title: 'Título novo', scheduleId: s2, reminded: true }]);
    expect(await lives(fan, tx2.id)).toEqual([]);
    expect(await lives(ana, tx2.id)).toEqual([]);
    await endAll(h2);
    await clear(h2);
  });

  it('ligação automática: uma Txillada normal até 60 min antes liga-se ao agendamento mais próximo e avisa os lembretes', async () => {
    const { h3, ana, rui } = u;
    const near = (await schedule(h3, { startsAt: ahead(45 * MIN) }).expect(201)).body.id as string;
    const later = (await schedule(h3, { startsAt: ahead(3 * HOUR) }).expect(201)).body.id as string;
    await remind(rui, near).expect(200);
    await remind(rui, later).expect(200);
    const tx = (await open(h3, { title: 'Sem agenda' }).expect(201)).body.txillada;
    expect(await srow(near)).toMatchObject({ status: 'started', txillada_id: tx.id });
    expect(await srow(later)).toMatchObject({ status: 'scheduled', txillada_id: null });
    await until(async () => (await lives(rui, tx.id)).length > 0);
    expect(await lives(rui, tx.id)).toEqual([{ txilladaId: tx.id, title: 'Sem agenda', scheduleId: near, reminded: true }]);
    await until(async () => (await lives(ana, tx.id)).length > 0);
    expect(await lives(ana, tx.id)).toEqual([{ txilladaId: tx.id, title: 'Sem agenda' }]);
    await endAll(h3);
    // Mais de 60 minutos antes: não liga.
    const tx2 = (await open(h3, { title: 'Cedo' }).expect(201)).body.txillada;
    expect(await srow(later)).toMatchObject({ status: 'scheduled', txillada_id: null });
    void tx2;
    await endAll(h3);
    await clear(h3);
  });

  it('avisos ao anfitrião (15 min e na hora, uma vez cada), expirar e limpar', async () => {
    const { host, ana, rui } = u;
    const id = (await schedule(host, { title: 'Aviso', startsAt: ahead(3 * HOUR) }).expect(201)).body.id as string;
    await remind(ana, id).expect(200);
    await remind(rui, id).expect(200);
    await pool.query(`DELETE FROM social.notifications WHERE user_id = $1`, [host.id]);
    pushes.length = 0;
    // Ainda longe: nada.
    expect(await svc.tick()).toMatchObject({ soon: 0, now: 0 });
    // Daqui a 10 min: o aviso dos 15 min, uma vez.
    await pool.query(`UPDATE content.txillada_schedules SET starts_at = now() + interval '10 minutes' WHERE id = $1`, [id]);
    expect((await svc.tick()).soon).toBe(1);
    expect((await svc.tick()).soon).toBe(0);
    const soon = await notes(host, 'txillada_scheduled_soon');
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({ actor_id: host.id, data: { scheduleId: id, title: 'Aviso' } });
    expect(pushes.find((p) => p.userId === host.id)?.p).toMatchObject({ title: 'Txillada', body: 'A tua Txillada começa daqui a 15 min', url: `/txillada/agendada/${id}`, category: 'txilladas' });
    // Na hora: «é agora», com quantos pediram, uma vez.
    pushes.length = 0;
    await pool.query(`UPDATE content.txillada_schedules SET starts_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    expect((await svc.tick()).now).toBe(1);
    expect((await svc.tick()).now).toBe(0);
    expect((await notes(host, 'txillada_scheduled_now'))[0].data).toMatchObject({ scheduleId: id, reminders: 2 });
    expect(pushes.find((p) => p.userId === host.id)?.p.body).toBe('Está na hora da tua Txillada. 2 pessoas pediram para ser lembradas.');
    // Na lista, vêm como Txillapp.
    const list = (await api().get('/api/v1/notifications').set(auth(host)).expect(200)).body.items as any[];
    expect(list.find((x) => x.kind === 'txillada_scheduled_now')?.actor).toMatchObject({ username: 'txillapp', staff: true });
    // Mudar a hora volta a pôr os avisos por mandar.
    await patch(host, id, { startsAt: ahead(20 * MIN) }).expect(200);
    expect(await srow(id)).toMatchObject({ host_reminded_at: null, host_now_at: null });
    // Com «Txilladas» desligado: nem lista nem telemóvel.
    await pool.query(`INSERT INTO social.notification_prefs (user_id, off) VALUES ($1, ARRAY['txilladas']) ON CONFLICT (user_id) DO UPDATE SET off = EXCLUDED.off`, [host.id]);
    await pool.query(`UPDATE content.txillada_schedules SET starts_at = now() + interval '5 minutes' WHERE id = $1`, [id]);
    expect((await svc.tick()).soon).toBe(1);
    expect(await notes(host, 'txillada_scheduled_soon')).toHaveLength(1);
    await pool.query(`DELETE FROM social.notification_prefs WHERE user_id = $1`, [host.id]);

    // Expirar: 2 h depois da hora sem começar, sem avisos.
    await pool.query(`UPDATE content.txillada_schedules SET starts_at = now() - interval '3 hours', host_now_at = NULL WHERE id = $1`, [id]);
    const before = (await notes(host, 'txillada_scheduled_now')).length;
    expect((await svc.tick())).toMatchObject({ now: 0, expired: 1 });
    expect((await srow(id)).status).toBe('expired');
    expect(await notes(host, 'txillada_scheduled_now')).toHaveLength(before);
    expect((await get(ana, id).expect(200)).body.status).toBe('expired');
    // Limpar: os expirados e cancelados com mais de 30 dias saem, com os lembretes; os mais novos ficam.
    expect(await svc.purge()).toBe(0);
    await pool.query(`UPDATE content.txillada_schedules SET updated_at = now() - interval '31 days' WHERE id = $1`, [id]);
    expect(await svc.purge()).toBeGreaterThanOrEqual(1);
    expect(await srow(id)).toBeUndefined();
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_schedule_reminders WHERE schedule_id = $1', [id])).rows[0].n).toBe(0);
    await clear(host);
  });

  it('perfil: nextTxillada é o próximo agendamento que eu posso ver', async () => {
    const { host, ana, rui, blk } = u;
    const profile = async (x: U) => (await api().get(`/api/v1/users/${host.username}`).set(auth(x)).expect(200)).body.nextTxillada;
    expect(await profile(ana)).toBeNull();
    const at1 = ahead(2 * HOUR);
    const fr = (await schedule(host, { title: 'Amigos', audience: 'friends', startsAt: at1 }).expect(201)).body.id as string;
    const at2 = ahead(4 * HOUR);
    const pub = (await schedule(host, { title: 'Todos', startsAt: at2 }).expect(201)).body.id as string;
    await remind(ana, fr).expect(200);
    expect(await profile(ana)).toEqual({ id: fr, startsAt: new Date(at1).toISOString(), title: 'Amigos', reminded: true });
    expect(await profile(rui)).toEqual({ id: pub, startsAt: new Date(at2).toISOString(), title: 'Todos', reminded: false });
    expect(await profile(host)).toMatchObject({ id: fr });
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [host.id]);
    expect(await profile(rui)).toBeNull();
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [host.id]);
    void blk;
    await clear(host);
  });

  it('começar apaga os lembretes e guarda quantos eram (contas ativas) em reminders_count; a exportação conta igual', async () => {
    const { h4, ana, rui, off } = u;
    const s = (await schedule(h4, { title: 'Contas', startsAt: ahead(40 * MIN) }).expect(201)).body.id as string;
    for (const x of [ana, rui, off]) await remind(x, s).expect(200);
    // Uma conta suspensa não conta (nem na app, nem no aviso «é agora», nem na exportação).
    await pool.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1`, [off.id]);
    expect((await get(h4, s).expect(200)).body.reminders).toBe(2);
    const exported = async () => ((await api().get('/api/v1/me/export').set(auth(h4)).expect(200)).body.txilladaSchedules as any[]).find((x) => x.id === s);
    expect((await exported()).reminders).toBe(2);
    const tx = (await open(h4, { scheduleId: s }).expect(201)).body.txillada;
    await until(async () => (await lives(rui, tx.id)).length > 0 && (await srow(s)).reminders_count != null);
    expect(await lives(ana, tx.id)).toEqual([{ txilladaId: tx.id, title: 'Contas', scheduleId: s, reminded: true }]);
    // Os lembretes já não servem: saem; o número fica.
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_schedule_reminders WHERE schedule_id = $1', [s])).rows[0].n).toBe(0);
    expect(await srow(s)).toMatchObject({ status: 'started', reminders_count: 2 });
    expect((await get(h4, s).expect(200)).body).toMatchObject({ status: 'started', reminders: 2 });
    expect((await get(ana, s).expect(200)).body).toMatchObject({ reminded: false, reminders: null });
    expect((await exported()).reminders).toBe(2);
    // Os lembretes que pedi também saem da minha exportação.
    expect(((await api().get('/api/v1/me/export').set(auth(rui)).expect(200)).body.txilladaReminders as any[]).map((x) => x.scheduleId)).not.toContain(s);
    await pool.query(`UPDATE identity.users SET status = 'active' WHERE id = $1`, [off.id]);
    await endAll(h4);
    await clear(h4);
  });

  it('denunciar: quem vê denuncia e deixa de a ver; a fila mostra-a; «Retirar» avisa quem pediu lembrete e fecha tudo', async () => {
    const { h4: host, den, rui, ana, blk } = u;
    // O h4 (o host já gastou os 30 agendamentos por hora). O blk não o bloqueou: o 404 é de um id que não existe.
    await follow(den, host);
    const at = ahead(3 * HOUR);
    const s = (await schedule(host, { title: 'Título feio', goal: 100, goalPurpose: 'Livros', startsAt: at }).expect(201)).body.id as string;
    const other = (await schedule(host, { title: 'Outra', startsAt: ahead(6 * HOUR) }).expect(201)).body.id as string;
    await remind(den, s).expect(200);
    await remind(rui, s).expect(200);
    const report = (x: U, id: string, body: Record<string, unknown>) => api().post(`/api/v1/txilladas/schedules/${id}/report`).set(auth(x)).send(body);
    // O anfitrião não se denuncia; um motivo fora da lista: 400; quem não a vê: 404.
    expect((await report(host, s, { reason: 'spam' }).expect(400)).body.message).toBe('Não podes denunciar o teu próprio conteúdo');
    await report(den, s, { reason: 'qualquer' }).expect(400);
    await report(blk, '00000000-0000-7000-8000-000000000000', { reason: 'spam' }).expect(404);
    await report(den, s, { reason: 'hate', note: 'O título ofende' }).expect(204);
    // Deixa de lhe aparecer: o cartão, a lista do perfil, «Em breve» e o nextTxillada; o lembrete sai.
    await get(den, s).expect(404);
    await remind(den, s).expect(404);
    const listed = (await api().get(`/api/v1/txilladas/schedules?username=${host.username}`).set(auth(den)).expect(200)).body.items.map((x: any) => x.id);
    expect(listed).toEqual([other]);
    const up = (await api().get('/api/v1/txilladas/schedules/upcoming').set(auth(den)).expect(200)).body.items.map((x: any) => x.id);
    expect(up).toContain(other);
    expect(up).not.toContain(s);
    expect((await api().get(`/api/v1/users/${host.username}`).set(auth(den)).expect(200)).body.nextTxillada).toMatchObject({ id: other });
    expect((await pool.query('SELECT 1 FROM content.txillada_schedule_reminders WHERE schedule_id = $1 AND user_id = $2', [s, den.id])).rowCount).toBe(0);
    // Os outros continuam a vê-la (até a moderação decidir).
    expect((await get(rui, s).expect(200)).body.reminded).toBe(true);
    expect((await api().get(`/api/v1/users/${host.username}`).set(auth(ana)).expect(200)).body.nextTxillada).toMatchObject({ id: s });
    // Uma cancelada já não se denuncia.
    await cancel(host, other).expect(204);
    expect((await report(rui, other, { reason: 'spam' }).expect(409)).body).toMatchObject({ code: 'not_scheduled' });

    // A fila: o título, o motivo da meta, o anfitrião e a hora.
    const mod = await staffLogin(app, 'agmod', ['moderacao']);
    const staff = { Authorization: `Bearer ${mod.token}` };
    const queue = async (status = 'open') =>
      ((await api().get('/api/v1/admin/mod/queue').query({ type: 'txillada_schedule', status }).set(staff).expect(200)).body.items as any[]).find((x) => x.id === s);
    expect(await queue()).toMatchObject({
      type: 'txillada_schedule', reports: 1, reasons: ['hate'], preview: 'Título feio · Meta: Livros', removed: null,
      owner: { username: host.username },
      schedule: { title: 'Título feio', goalPurpose: 'Livros', startsAt: new Date(at).toISOString(), status: 'scheduled' },
    });
    // Retirar: fica 'removed' (quem e porquê); quem pediu lembrete recebe o aviso com removed: true.
    pushes.length = 0;
    const done = (await api().post('/api/v1/admin/mod/queue/decide').set(staff)
      .send({ items: [{ type: 'txillada_schedule', id: s }], action: 'remove', note: 'Título ofensivo' })).body;
    expect(done).toMatchObject({ done: [{ type: 'txillada_schedule', id: s }], failed: [] });
    expect(await srow(s)).toMatchObject({ status: 'removed', removed_by: mod.userId, removed_reason: 'Título ofensivo' });
    await until(async () => (await notes(rui, 'txillada_scheduled_cancelled')).some((x) => x.data.scheduleId === s));
    expect((await notes(rui, 'txillada_scheduled_cancelled')).find((x) => x.data.scheduleId === s)).toEqual({
      actor_id: host.id, data: { scheduleId: s, startsAt: new Date(at).toISOString(), title: 'Título feio', moved: false, removed: true },
    });
    await until(async () => pushes.some((p) => p.userId === rui.id));
    expect(pushes.find((p) => p.userId === rui.id)?.p).toMatchObject({ body: `A Txillada de @${host.username} foi retirada`, url: `/txillada/agendada/${s}` });
    // Quem denunciou já não tinha lembrete: não recebe nada.
    expect((await notes(den, 'txillada_scheduled_cancelled')).filter((x) => x.data.scheduleId === s)).toEqual([]);
    // O anfitrião é avisado pela moderação.
    await until(async () => (await notes(host, 'content_removed')).some((x) => x.data.type === 'txillada_schedule'));
    expect((await notes(host, 'content_removed')).some((x) => x.data.type === 'txillada_schedule')).toBe(true);
    // Os lembretes saem; o cartão diz o estado; não se começa, edita, lembra nem cancela.
    await until(async () => (await pool.query('SELECT 1 FROM content.txillada_schedule_reminders WHERE schedule_id = $1', [s])).rowCount === 0);
    expect((await pool.query('SELECT 1 FROM content.txillada_schedule_reminders WHERE schedule_id = $1', [s])).rowCount).toBe(0);
    expect((await get(rui, s).expect(200)).body).toMatchObject({ status: 'removed', reminded: false, txilladaId: null, live: false });
    expect((await remind(rui, s).expect(409)).body).toMatchObject({ code: 'not_scheduled' });
    expect((await patch(host, s, { title: 'Outro' }).expect(409)).body).toMatchObject({ code: 'not_scheduled' });
    expect((await open(host, { scheduleId: s }).expect(409)).body).toMatchObject({ code: 'not_scheduled' });
    expect((await cancel(host, s).expect(409)).body).toMatchObject({ code: 'not_scheduled' });
    expect((await api().get(`/api/v1/users/${host.username}`).set(auth(ana)).expect(200)).body.nextTxillada).toBeNull();
    expect(await queue('actioned')).toMatchObject({ removed: 'moderation', resolution: 'remove', schedule: { status: 'removed' } });
    // A exportação do anfitrião diz que foi retirada e porquê.
    expect(((await api().get('/api/v1/me/export').set(auth(host)).expect(200)).body.txilladaSchedules as any[]).find((x) => x.id === s))
      .toMatchObject({ status: 'removed', removedReason: 'Título ofensivo' });
    // Limpeza: sai ao fim de 30 dias, como as canceladas.
    await pool.query(`UPDATE content.txillada_schedules SET updated_at = now() - interval '31 days' WHERE id = $1`, [s]);
    await svc.purge();
    expect(await srow(s)).toBeUndefined();
    await clear(host);
  });

  it('editar com a conta suspensa: 403; cancelar deixa sempre; com a Txillada desligada, lembrar e editar dão 503', async () => {
    const { sus, rui } = u;
    const s = (await schedule(sus, { startsAt: ahead(3 * HOUR) }).expect(201)).body.id as string;
    const s2 = (await schedule(sus, { startsAt: ahead(6 * HOUR) }).expect(201)).body.id as string;
    await remind(rui, s).expect(200);
    await pool.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1`, [sus.id]);
    expect((await patch(sus, s, { title: 'Novo' }).expect(403)).body.message).toBe('A tua conta não pode abrir uma Txillada.');
    expect((await srow(s)).title).toBe('Conversa');
    await cancel(sus, s).expect(204);
    await pool.query(`UPDATE identity.users SET status = 'active' WHERE id = $1`, [sus.id]);
    // A Txillada desligada (sem o servidor das salas).
    const cfg = (svc as any).config;
    (svc as any).config = { ...cfg, LIVEKIT_URL: undefined };
    try {
      await remind(rui, s2).expect(503);
      await unremind(rui, s2).expect(503);
      await patch(sus, s2, { title: 'Novo' }).expect(503);
      await cancel(sus, s2).expect(204);
    } finally {
      (svc as any).config = cfg;
    }
    expect((await srow(s2)).status).toBe('cancelled');
    await clear(sus);
  });

  it('exportação e apagar a conta: os agendamentos e os lembretes saem', async () => {
    const { gone, ana, host } = u;
    const mineId = (await schedule(gone, { title: 'Minha', audience: 'paid', price: 7, startsAt: ahead(3 * HOUR) }).expect(201)).body.id as string;
    await remind(ana, mineId).expect(200);
    const theirs = (await schedule(host, { title: 'Dele', startsAt: ahead(5 * HOUR) }).expect(201)).body.id as string;
    await remind(gone, theirs).expect(200);
    const ex = (await api().get('/api/v1/me/export').set(auth(gone)).expect(200)).body;
    expect(ex.txilladaSchedules).toEqual([expect.objectContaining({ id: mineId, title: 'Minha', audience: 'paid', price: 7, status: 'scheduled', reminders: 1 })]);
    expect(JSON.stringify(ex.txilladaSchedules)).not.toContain(ana.username);
    expect(ex.txilladaReminders).toEqual([expect.objectContaining({ scheduleId: theirs, host: host.username, title: 'Dele' })]);
    await api().post('/api/v1/auth/delete-account').set(auth(gone)).send({ confirmUsername: gone.username, password: PASSWORD }).expect(204);
    expect(await srow(mineId)).toBeUndefined();
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_schedule_reminders WHERE user_id = $1 OR schedule_id = $2', [gone.id, mineId])).rows[0].n).toBe(0);
    // Uma conta eliminada não gera avisos: quem pediu lembrete não recebe nada; o cartão (a ligação) dá 404 («já não existe»).
    await new Promise((r) => setTimeout(r, 150));
    expect((await notes(ana, 'txillada_scheduled_cancelled')).filter((x) => x.data.scheduleId === mineId)).toEqual([]);
    await get(ana, mineId).expect(404);
    expect((await get(host, theirs).expect(200)).body.reminders).toBe(0);
    await clear(host);
  });
});
