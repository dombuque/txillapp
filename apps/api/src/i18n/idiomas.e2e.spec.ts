import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import webpush from 'web-push';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService, type PushPayload } from '../push/push.service';
import { MailService } from '../mail/mail.service';
import { fridayMessage } from '../gelada/gelada-friday.service';
import { composeMessage } from '../reminders/comeback';
import { whenLabel } from '../txillada/txillada-when';
import { pickLang, reloadCatalogs, t, translateText } from './i18n';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

// Um catálogo de teste por cima do gerado: o teste não depende do que a máquina traduziu.
const EN = {
  'Dados inválidos': 'Invalid data',
  'Escreve um link válido (por exemplo, o-teu-site.com)': 'Write a valid link (for example, your-site.com)',
  'Usa um e-mail a sério (os temporários não dão).': 'Use a real e-mail (temporary ones are not allowed).',
  'começou a seguir-te': 'started following you',
  '@{n} não existe': '@{n} does not exist',
  'brindou {a}': 'toasted {a}',
  'a tua tcheka': 'your tcheka',
  'criou uma sondagem': 'created a poll',
  'Confirma o teu e-mail': 'Confirm your e-mail',
  'Olá, {name}! Falta só confirmar que este e-mail é teu para poderes publicar, comentar e conversar no Txillapp.': 'Hi, {name}! Just confirm this e-mail is yours to post, comment and chat on Txillapp.',
  'É sexta 🍻 {who} ainda te deve uma. Cobra-lhe! Bebe com moderação 🙌': "It's Friday 🍻 {who} still owes you one. Collect it! Drink responsibly 🙌",
  'Sexta da gelada': 'Gelada Friday',
  'Tens {count} mensagem por ler._one': 'You have {count} unread message.',
  'Tens {count} mensagem por ler._other': 'You have {count} unread messages.',
  'Uma mensagem à tua espera_one': 'A message is waiting for you',
  'Uma mensagem à tua espera_other': 'Messages are waiting for you',
  'amanhã, {time}': 'tomorrow, {time}',
};

interface U { token: string; id: string; username: string }

describe('Idiomas na API: erros no idioma do pedido, language na conta, pushes e e-mails no idioma de quem recebe (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const keys = webpush.generateVAPIDKeys();
  const sent: { userId: string; p: PushPayload }[] = [];

  async function signup(name: string, headers: Record<string, string> = {}): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set(headers).send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const settle = async () => {
    let before = -1;
    while (before !== sent.length) {
      before = sent.length;
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    reloadCatalogs({ en: EN });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'b'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', MAIL_CAPTURE: 'true', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }),
    );
    await app.init();
    // O push é simulado depois da tradução: guarda o texto final, como chegaria ao telemóvel.
    jest.spyOn(app.get(PushService), 'deliver').mockImplementation(async (userId: string, p: PushPayload) => {
      sent.push({ userId, p });
      return 1;
    });
  }, 60_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    reloadCatalogs();
    await app.close();
    await pool.end();
  });

  it('Accept-Language: só os códigos da lista; senão pt', () => {
    expect(pickLang('en-US,en;q=0.9,pt;q=0.8')).toBe('en');
    expect(pickLang('fr-FR,fr')).toBe('pt');
    expect(pickLang(undefined)).toBe('pt');
    expect(pickLang('pt-MZ')).toBe('pt');
  });

  it('erros em en com Accept-Language: en (message, issues e code ficam), pt por omissão', async () => {
    const a = await signup('ida');
    const pt = await api().patch('/api/v1/users/me').set(auth(a)).send({ website: 'x' }).expect(400);
    expect(pt.body.message).toBe('Dados inválidos');
    expect(pt.body.issues[0].message).toBe('Escreve um link válido (por exemplo, o-teu-site.com)');

    const en = await api().patch('/api/v1/users/me').set(auth(a)).set('Accept-Language', 'en-GB,en;q=0.9').send({ website: 'x' }).expect(400);
    expect(en.body.message).toBe('Invalid data');
    expect(en.body.issues[0]).toMatchObject({ path: 'website', message: 'Write a valid link (for example, your-site.com)' });

    // Um idioma fora da lista fica em português.
    const fr = await api().patch('/api/v1/users/me').set(auth(a)).set('Accept-Language', 'fr').send({ website: 'x' }).expect(400);
    expect(fr.body.message).toBe('Dados inválidos');

    // O `code` não muda.
    const u = `idb${run}`.slice(0, 28);
    const d = await api().post('/api/v1/auth/register').set('Accept-Language', 'en').send({ email: `${u}@mailinator.com`, username: u, displayName: 'X', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(400);
    expect(d.body).toMatchObject({ code: 'disposable_email', message: 'Use a real e-mail (temporary ones are not allowed).' });
  });

  it('texto montado com variáveis: reconhece a frase do catálogo e traduz as partes que também são frases', () => {
    expect(translateText('@ze não existe', 'en')).toBe('@ze does not exist');
    expect(translateText('brindou a tua tcheka', 'en')).toBe('toasted your tcheka');
    expect(translateText('Ana: criou uma sondagem', 'en')).toBe('Ana: created a poll');
    expect(translateText('Uma frase que não está no catálogo', 'en')).toBe('Uma frase que não está no catálogo');
    expect(translateText('brindou a tua tcheka', 'pt')).toBe('brindou a tua tcheka');
  });

  it('t() com plural como na app; datas e textos montados no idioma de quem recebe', () => {
    expect(t('{count} brinde', { count: 1, other: '{count} brindes' })).toBe('1 brinde');
    expect(t('{count} brinde', { count: 0, other: '{count} brindes' })).toBe('0 brindes');
    const none = { unreadMessages: 0, cheers: null, posters: null, newStories: 0 };
    expect(composeMessage({ ...none, unreadMessages: 3 }, 1).body).toBe('Tens 3 mensagens por ler.');
    expect(composeMessage({ ...none, unreadMessages: 3 }, 1, 'en')).toMatchObject({ title: 'Messages are waiting for you', body: 'You have 3 unread messages.' });
    expect(composeMessage({ ...none, unreadMessages: 1 }, 1, 'en').body).toBe('You have 1 unread message.');
    expect(fridayMessage({ adult: true, debtor: { username: 'januario', article: 'O' } }).body).toBe('É sexta 🍻 O @januario ainda te deve uma. Cobra-lhe! Bebe com moderação 🙌');
    expect(fridayMessage({ adult: true, debtor: { username: 'januario', article: 'O' } }, 'en')).toMatchObject({ title: 'Gelada Friday', body: "It's Friday 🍻 @januario still owes you one. Collect it! Drink responsibly 🙌" });
    const now = new Date('2026-11-17T10:00:00Z');
    const tomorrow = new Date('2026-11-18T18:00:00Z');
    expect(whenLabel(tomorrow, now)).toBe('amanhã, 20:00');
    expect(whenLabel(tomorrow, now, 'en')).toBe('tomorrow, 20:00');
    expect(whenLabel(new Date('2026-12-25T18:00:00Z'), now, 'en')).toBe('25 December, 20:00');
  });

  it('guardar language no perfil (PATCH /users/me), GET /auth/me devolve-o; null volta a «não escolhido»; só códigos da lista', async () => {
    const a = await signup('idc');
    expect((await api().get('/api/v1/auth/me').set(auth(a)).expect(200)).body.language).toBeNull();
    expect((await api().patch('/api/v1/users/me').set(auth(a)).send({ language: 'en' }).expect(200)).body.language).toBe('en');
    expect((await api().get('/api/v1/auth/me').set(auth(a)).expect(200)).body.language).toBe('en');
    await api().patch('/api/v1/users/me').set(auth(a)).send({ language: 'fr' }).expect(400);
    // Mudar outra coisa não mexe no idioma.
    expect((await api().patch('/api/v1/users/me').set(auth(a)).send({ bio: 'olá' }).expect(200)).body.language).toBe('en');
    expect((await api().patch('/api/v1/users/me').set(auth(a)).send({ language: null }).expect(200)).body.language).toBeNull();
    // A regra da base de dados também.
    await expect(pool.query("UPDATE identity.users SET language = 'xx' WHERE id = $1", [a.id])).rejects.toThrow();
  });

  it('push de um aviso em en para quem tem language en; pt para quem não escolheu', async () => {
    const en = await signup('idd');
    const pt = await signup('ide');
    const fan = await signup('idf');
    await api().patch('/api/v1/users/me').set(auth(en)).send({ language: 'en' }).expect(200);
    // Quem segue escreve em pt: o push sai no idioma de quem o recebe, não no do pedido.
    await api().post(`/api/v1/users/${en.username}/follow`).set(auth(fan)).expect(200);
    await api().post(`/api/v1/users/${pt.username}/follow`).set(auth(fan)).set('Accept-Language', 'en').expect(200);
    await settle();
    const toEn = sent.find((s) => s.userId === en.id && s.p.tag?.startsWith('follow:'));
    const toPt = sent.find((s) => s.userId === pt.id && s.p.tag?.startsWith('follow:'));
    expect(toEn?.p).toMatchObject({ title: 'idf Teste', body: 'started following you' });
    expect(toPt?.p).toMatchObject({ body: 'começou a seguir-te' });
  });

  it('e-mail no idioma da conta; sem escolha, no do pedido de quem o pediu', async () => {
    const mail = app.get(MailService);
    const a = await signup('idg', { 'Accept-Language': 'en' });
    const first = mail.outbox.find((m) => m.to === `${a.username}@example.com`);
    // O assunto leva o código de 6 dígitos (vê-se na notificação), no idioma da conta.
    expect(first?.subject).toMatch(/^[0-9]{6} is your Txillapp code$/);
    expect(first?.html).toContain('<html lang="en">');
    expect(first?.text).toContain('Hi, idg!');
  });

  it('exportação inclui language; apagar a conta limpa-o', async () => {
    const a = await signup('idh');
    await api().patch('/api/v1/users/me').set(auth(a)).send({ language: 'en' }).expect(200);
    expect((await api().get('/api/v1/me/export').set(auth(a)).expect(200)).body.profile.language).toBe('en');
    await api().post('/api/v1/auth/delete-account').set(auth(a)).send({ confirmUsername: a.username, password: PASSWORD }).expect(204);
    expect((await pool.query('SELECT language FROM identity.users WHERE id = $1', [a.id])).rows[0].language).toBeNull();
  });
});
