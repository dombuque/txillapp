import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import http from 'http';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

describe('mensagens directas e respostas a stories no chat (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD , birthDate: '1990-06-15', acceptTerms: true}).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const send = (from: U, to: U, body: string) => api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ body });
  const list = async (x: U) => (await api().get('/api/v1/chat/conversations').set(auth(x)).expect(200)).body as { username: string; unread: number; lastMessage: { body: string; kind: string; fromMe: boolean } }[];
  const thread = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}`).set(auth(x)).expect(200)).body;
  async function uploadPng(a: U) {
    const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return r.body.assetId as string;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['ca', 'cb', 'cc', 'cd']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('envia, recebe, conta por ler e marca como lido ao abrir', async () => {
    const { ca, cb } = u;
    await send(cb, ca, 'olá, tudo bem?').expect(201);
    await send(cb, ca, 'segunda mensagem').expect(201);
    const mine = (await list(ca)).find((c) => c.username === cb.username)!;
    expect(mine.unread).toBe(2);
    expect(mine.lastMessage).toMatchObject({ body: 'segunda mensagem', fromMe: false });
    expect((await api().get('/api/v1/chat/unread').set(auth(ca)).expect(200)).body.conversations).toBeGreaterThanOrEqual(1);

    const t = await thread(ca, cb);
    expect(t.items.map((m: { body: string }) => m.body)).toEqual(['segunda mensagem', 'olá, tudo bem?']); // mais recente primeiro
    expect((await list(ca)).find((c) => c.username === cb.username)!.unread).toBe(0);
    await send(ca, ca, 'a mim próprio').expect(400);
  });

  it('respeita "quem pode enviar-me mensagens" e bloqueios; conversas que já existem continuam', async () => {
    const { ca, cb, cc } = u;
    await api().patch('/api/v1/settings/privacy').set(auth(ca)).send({ dmsAllowed: 'off' }).expect(200);
    await send(cc, ca, 'posso?').expect(403); // não aceita mensagens novas
    await send(ca, cc, 'olá cc').expect(201); // ca fala primeiro...
    await send(cc, ca, 'olá de volta').expect(201); // ...e cc já pode responder
    await send(cb, ca, 'e eu?').expect(201); // cb já tinha conversa com ca: continua
  });

  it('bloqueio impede mensagens nos dois sentidos', async () => {
    const { cc, cd } = u;
    await api().put(`/api/v1/blocks/${cd.username}`).set(auth(cc)).expect(200);
    await send(cd, cc, 'oi').expect(403);
    await send(cc, cd, 'oi').expect(403);
  });

  it('responder a um story chega ao autor como mensagem, com a foto do story', async () => {
    const { ca, cb } = u;
    const mediaId = await uploadPng(ca);
    const story = (await api().post('/api/v1/stories').set(auth(ca)).send({ mediaId, caption: 'olha isto' }).expect(201)).body;
    await api().patch('/api/v1/stories/settings').set(auth(ca)).send({ replies: 'everyone' }).expect(200);
    await api().post(`/api/v1/stories/${story.id}/replies`).set(auth(cb)).send({ body: 'Que vista!' }).expect(201);
    await api().post(`/api/v1/stories/${story.id}/replies`).set(auth(cb)).send({ body: '🔥' }).expect(201);

    const t = await thread(ca, cb);
    const [reaction, reply] = t.items;
    expect(reaction).toMatchObject({ kind: 'story_reaction', body: '🔥', fromMe: false });
    expect(reply).toMatchObject({ kind: 'story_reply', body: 'Que vista!' });
    expect(reply.storyUrl).toMatch(/^\/api\/v1\/media\//);
  });

  it('comentários públicos nos stories: vê quem pode ver o story; bloqueios e definições mandam', async () => {
    const { ca, cb, cc, cd } = u;
    const mediaId = await uploadPng(ca);
    const story = (await api().post('/api/v1/stories').set(auth(ca)).send({ mediaId, caption: 'comenta aqui' }).expect(201)).body;
    const cm = (x: U, body: string) => api().post(`/api/v1/stories/${story.id}/comments`).set(auth(x)).send({ body });
    const seen = async (x: U) => (await api().get(`/api/v1/stories/${story.id}/comments`).set(auth(x)).expect(200)).body as { id: string; body: string; canDelete: boolean }[];

    const first = (await cm(cb, 'que vista!').expect(201)).body.id;
    const second = (await cm(cc, 'adorei').expect(201)).body.id;
    expect((await seen(ca)).map((c) => c.body)).toEqual(['que vista!', 'adorei']); // o autor vê todos
    // cd foi bloqueado por cc: não vê o comentário de cc, mas vê o de cb
    expect((await seen(cd)).map((c) => c.body)).toEqual(['que vista!']);
    expect((await seen(cd)).every((c) => !c.canDelete)).toBe(true);
    const tray = (await api().get(`/api/v1/stories/user/${ca.username}`).set(auth(cb)).expect(200)).body.find((x: { id: string }) => x.id === story.id);
    expect(tray.commentCount).toBe(2); // o número é público

    await api().delete(`/api/v1/stories/comments/${second}`).set(auth(cd)).expect(404); // não é dele nem do autor do story
    await api().delete(`/api/v1/stories/comments/${second}`).set(auth(ca)).expect(204); // o autor do story apaga
    await api().delete(`/api/v1/stories/comments/${first}`).set(auth(cb)).expect(204); // e cada um apaga o seu
    expect(await seen(ca)).toEqual([]);

    await api().patch('/api/v1/stories/settings').set(auth(ca)).send({ replies: 'off' }).expect(200);
    await cm(cb, 'agora não').expect(403);
    await cm(ca, 'resposta do autor').expect(201); // o autor pode sempre
  });

  async function uploadChat(a: U, mime: string, bytes: Buffer) {
    const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime, size: bytes.length, purpose: 'chat' }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
    return r.body.assetId as string;
  }

  it('fotos e voz no chat: ficheiros privados (URL assinado), só do próprio e do tipo certo', async () => {
    const { ca, cb } = u;
    await api().patch('/api/v1/settings/privacy').set(auth(ca)).send({ dmsAllowed: 'everyone' }).expect(200);
    const img = await uploadChat(cb, 'image/png', PNG);
    await api().post(`/api/v1/chat/with/${ca.username}`).set(auth(cb)).send({ kind: 'image', mediaId: img, body: 'olha' }).expect(201);
    const voice = await uploadChat(cb, 'audio/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]));
    await api().post(`/api/v1/chat/with/${ca.username}`).set(auth(cb)).send({ kind: 'voice', mediaId: voice, durationMs: 4200 }).expect(201);

    const [vm, im] = (await thread(ca, cb)).items;
    expect(vm).toMatchObject({ kind: 'voice', durationMs: 4200, fromMe: false });
    expect(im).toMatchObject({ kind: 'image', body: 'olha' });
    await api().get(im.mediaUrl).expect(200).expect('Content-Type', /image\/png/); // URL assinado: sem login
    await api().get(im.mediaUrl.replace(/sig=.{6}/, 'sig=AAAAAA')).expect(403); // assinatura adulterada
    await api().get(`/api/v1/media/${img}`).expect(404); // nunca pela rota pública

    await api().post(`/api/v1/chat/with/${ca.username}`).set(auth(cb)).send({ kind: 'image', mediaId: img }).expect(400); // já usado
    const foreign = await uploadChat(ca, 'image/png', PNG);
    await api().post(`/api/v1/chat/with/${ca.username}`).set(auth(cb)).send({ kind: 'image', mediaId: foreign }).expect(400); // de outra pessoa
    const asAudio = await uploadChat(cb, 'audio/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 9, 9, 9, 9, 9, 9, 9, 9]));
    await api().post(`/api/v1/chat/with/${ca.username}`).set(auth(cb)).send({ kind: 'image', mediaId: asAudio }).expect(400); // tipo errado
    await api().post('/api/v1/media/uploads').set(auth(cb)).send({ mime: 'audio/webm', size: 10 }).expect(415); // áudio só no chat
  });

  it('apagar mensagem: desaparece para os dois, sem rasto; só quem enviou apaga; a escrever…', async () => {
    const { ca, cb } = u;
    const sent = (await send(cb, ca, 'mensagem a apagar').expect(201)).body.id;
    await send(cb, ca, 'esta fica').expect(201);
    await api().delete(`/api/v1/chat/messages/${sent}`).set(auth(ca)).expect(404); // não é dele
    await api().delete(`/api/v1/chat/messages/${sent}`).set(auth(cb)).expect(204);
    for (const viewer of [ca, cb]) {
      const t = await thread(viewer, viewer === ca ? cb : ca);
      expect(t.items.map((m: { body: string }) => m.body)).not.toContain('mensagem a apagar');
      expect(JSON.stringify(t)).not.toMatch(/apagad/i); // nada de "Mensagem apagada"
    }
    expect((await list(ca)).find((c) => c.username === cb.username)!.lastMessage.body).toBe('esta fica');
    await api().post(`/api/v1/chat/with/${ca.username}/typing`).set(auth(cb)).expect(204);
  });

  it('tempo real: o servidor avisa por SSE quando chega mensagem, alguém escreve ou lê', async () => {
    const { ca, cb } = u;
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const received: { type: string; from: string }[] = [];
    let encoding: string | undefined = 'nao-medido';
    const req = http.get({ port, path: '/api/v1/chat/stream', headers: { Authorization: `Bearer ${ca.token}`, Accept: 'text/event-stream', 'Accept-Encoding': 'gzip, deflate, br' } }, (res) => {
      // Como um browser a sério: aceita compressão. O servidor não pode comprimir o canal em tempo real.
      encoding = res.headers['content-encoding'];
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) if (line.startsWith('data:')) received.push(JSON.parse(line.slice(5)));
      });
    });
    try {
      await new Promise((r) => setTimeout(r, 400)); // ligação estabelecida
      await send(cb, ca, 'em tempo real').expect(201);
      await api().post(`/api/v1/chat/with/${ca.username}/typing`).set(auth(cb)).expect(204);
      await thread(cb, ca); // cb abre a conversa → ca sabe que foi lido
      await new Promise((r) => setTimeout(r, 400));
      const types = received.map((e) => e.type);
      expect(encoding).toBeUndefined(); // sem compressão no canal em tempo real
      expect(types).toContain('message');
      expect(types).toContain('typing');
      expect(received.every((e) => e.from === cb.username || e.type === 'ping')).toBe(true);
    } finally {
      req.destroy();
    }
    // sem sessão não há canal
    await api().get('/api/v1/chat/stream').expect(401);
  });
});
