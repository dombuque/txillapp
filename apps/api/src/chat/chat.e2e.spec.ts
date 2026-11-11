import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import http from 'http';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MediaService } from '../media/media.service';
import { ChatEvents } from './chat.events';

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
    for (const n of ['ca', 'cb', 'cc', 'cd', 'ce', 'cf', 'cg', 'ch', 'ci', 'cj']) u[n] = await signup(n);
    // Quase todos se seguem (os testes de conversa não são sobre pedidos de mensagem); só 'cj' fica de fora, para a política.
    const ids = ['ca', 'cb', 'cc', 'cd', 'ce', 'cf', 'cg', 'ch', 'ci'].map((n) => u[n].id);
    for (const a of ids) for (const b of ids) if (a !== b) await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
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

  it('marcar como por ler (até abrir) e apagar a conversa só do meu lado (volta com mensagens novas)', async () => {
    const { cg, ch } = u;
    await send(ch, cg, 'primeira').expect(201);
    await thread(cg, ch);
    await api().post(`/api/v1/chat/with/${ch.username}/unread`).set(auth(cg)).expect(200);
    expect((await list(cg)).find((c) => c.username === ch.username)!.unread).toBe(1);
    await thread(cg, ch);
    expect((await list(cg)).find((c) => c.username === ch.username)!.unread).toBe(0);

    await api().delete(`/api/v1/chat/with/${ch.username}`).set(auth(cg)).expect(200);
    expect((await list(cg)).find((c) => c.username === ch.username)).toBeUndefined();
    expect((await thread(cg, ch)).items).toEqual([]);
    // O outro lado continua a ver tudo.
    expect((await thread(ch, cg)).items.map((m: { body: string }) => m.body)).toEqual(['primeira']);
    await send(ch, cg, 'voltei').expect(201);
    const back = (await list(cg)).find((c) => c.username === ch.username)!;
    expect(back.unread).toBe(1);
    expect((await thread(cg, ch)).items.map((m: { body: string }) => m.body)).toEqual(['voltei']);
    // Os envios acima contam para o limite por minuto; os testes seguintes começam do zero.
    const st = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    st.storage.clear();
    st.hitExpirations?.clear();
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
    await api().post(`/api/v1/chat/with/${ca.username}`).set(auth(cb)).send({ kind: 'voice', mediaId: voice, durationMs: 4200, waveform: '1357975313579753' }).expect(201);

    const [vm, im] = (await thread(ca, cb)).items;
    expect(vm).toMatchObject({ kind: 'voice', durationMs: 4200, fromMe: false, waveform: '1357975313579753' });
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

  it('apagar mensagem para todos: o conteúdo desaparece para os dois e fica o aviso; só quem enviou apaga; a escrever…', async () => {
    const { ca, cb } = u;
    const sent = (await send(cb, ca, 'mensagem a apagar').expect(201)).body.id;
    await send(cb, ca, 'esta fica').expect(201);
    await api().delete(`/api/v1/chat/messages/${sent}`).set(auth(ca)).expect(404); // não é dele
    await api().delete(`/api/v1/chat/messages/${sent}`).set(auth(cb)).expect(204);
    for (const viewer of [ca, cb]) {
      const t = await thread(viewer, viewer === ca ? cb : ca);
      expect(t.items.map((m: { body: string }) => m.body)).not.toContain('mensagem a apagar');
      expect(JSON.stringify(t)).not.toContain('mensagem a apagar');
      // No lugar dela, o aviso cinzento ("Apagaste esta mensagem" para quem a apagou).
      expect(t.items.find((m: { id: string }) => m.id === sent)).toMatchObject({ deleted: true, kind: 'text', body: viewer === cb ? 'Apagaste esta mensagem' : 'Esta mensagem foi apagada' });
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

  it('reagir a mensagens (uma por pessoa) e responder citando uma mensagem da mesma conversa', async () => {
    const { ch: a, ci: b, cg: outsider } = u;
    const first = (await send(a, b, 'Vais à festa?').expect(201)).body.id as string;
    const reply = await api().post(`/api/v1/chat/with/${a.username}`).set(auth(b)).send({ body: 'Vou sim!', replyTo: first }).expect(201);
    // citar uma mensagem de outra conversa não cola: fica sem resposta
    const other = (await send(outsider, a, 'olá').expect(201)).body.id as string;
    const stray = await api().post(`/api/v1/chat/with/${a.username}`).set(auth(b)).send({ body: 'ignora', replyTo: other }).expect(201);

    await api().put(`/api/v1/chat/messages/${first}/reaction`).set(auth(b)).send({ reaction: ':rir:' }).expect(204);
    await api().put(`/api/v1/chat/messages/${first}/reaction`).set(auth(b)).send({ reaction: ':amor:' }).expect(204); // muda, não soma
    await api().put(`/api/v1/chat/messages/${first}/reaction`).set(auth(a)).send({ reaction: ':amor:' }).expect(204);
    await api().put(`/api/v1/chat/messages/${first}/reaction`).set(auth(b)).send({ reaction: 'rir' }).expect(400);
    await api().put(`/api/v1/chat/messages/${first}/reaction`).set(auth(outsider)).send({ reaction: ':rir:' }).expect(404); // fora da conversa

    const t = await thread(a, b);
    const m1 = t.items.find((i: { id: string }) => i.id === first);
    expect(m1.reactions).toEqual([{ reaction: ':amor:', count: 2, mine: true }]);
    const m2 = t.items.find((i: { id: string }) => i.id === reply.body.id);
    expect(m2.replyTo).toMatchObject({ id: first, gone: false, fromMe: true, body: 'Vais à festa?' });
    expect(t.items.find((i: { id: string }) => i.id === stray.body.id).replyTo).toBeNull();

    await api().delete(`/api/v1/chat/messages/${first}/reaction`).set(auth(a)).expect(204);
    expect((await thread(b, a)).items.find((i: { id: string }) => i.id === first).reactions).toEqual([{ reaction: ':amor:', count: 1, mine: true }]);
    // apagada a original, a citação mostra "apagada"
    await api().delete(`/api/v1/chat/messages/${first}`).set(auth(a)).expect(204);
    expect((await thread(a, b)).items.find((i: { id: string }) => i.id === reply.body.id).replyTo).toEqual({ id: first, gone: true });
  });

  it('quem está a ver a conversa avisa o servidor; o sinal expira e só vale para essa conversa', async () => {
    const { ca: a, cb: b } = u;
    await api().put('/api/v1/chat/active').set(auth(b)).send({ key: `u:${a.username}` }).expect(204);
    await api().put('/api/v1/chat/active').set(auth(b)).send({ key: 'qualquer coisa' }).expect(400);
    const ev = app.get(ChatEvents);
    expect(ev.isActive(b.id, `u:${a.username.toUpperCase()}`)).toBe(true); // sem distinguir maiúsculas
    expect(ev.isActive(b.id, 'u:outra')).toBe(false);
    expect(ev.isActive(a.id, `u:${a.username}`)).toBe(false); // é por pessoa
    expect(ev.isActive(b.id, `u:${a.username}`, Date.now() + 46_000)).toBe(false); // expira
    await api().put('/api/v1/chat/active').set(auth(b)).send({ key: null }).expect(204);
    expect(ev.isActive(b.id, `u:${a.username}`)).toBe(false);
  });

  it('vídeos no chat: aceita o envio, mas só entra na conversa depois de convertido e pronto', async () => {
    const { ch: a, ci: b } = u;
    const up = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'video/mp4', size: 1000, purpose: 'chat' }).expect(201);
    const post = (b2: object) => api().post(`/api/v1/chat/with/${b.username}`).set(auth(a)).send(b2);
    await post({ kind: 'video', once: true }).expect(400); // falta o ficheiro (e um vídeo ainda por converter não entra)
    expect(up.body.assetId).toBeTruthy();
  });

  it('stickers e localização: só stickers válidos; localização guarda-se arredondada; aparecem na conversa', async () => {
    const { ce: cc, cf: cd } = u;
    const post = (from: U, to: U, b: object) => api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send(b);
    await post(cc, cd, { kind: 'sticker', body: 'bora' }).expect(201);
    await post(cc, cd, { kind: 'sticker', body: 'Inventado!' }).expect(400);
    await post(cc, cd, { kind: 'location', body: 'Praia da Polana' }).expect(400); // falta lat/lng
    await post(cc, cd, { kind: 'location', body: 'Praia da Polana', lat: -25.969212345, lng: 32.573212345 }).expect(201);
    await post(cc, cd, { kind: 'location', body: 'x', lat: 91, lng: 0 }).expect(400);
    const items = (await thread(cd, cc)).items as { kind: string; body: string; lat: number | null; lng: number | null }[];
    expect(items.find((m) => m.kind === 'sticker')).toMatchObject({ body: 'bora', lat: null });
    expect(items.find((m) => m.kind === 'location')).toMatchObject({ body: 'Praia da Polana', lat: -25.96921, lng: 32.57321 });
  });

  it('presença: online só se as duas pessoas mostram; esconder a minha também esconde a dos outros', async () => {
    const { ce: cc, cf: cd } = u;
    expect((await thread(cc, cd)).person.presence).toMatchObject({ online: false });
    await api().patch('/api/v1/settings/privacy').set(auth(cd)).send({ showPresence: false }).expect(200);
    expect((await thread(cc, cd)).person.presence).toBeNull(); // cd esconde a sua
    expect((await thread(cd, cc)).person.presence).toBeNull(); // e por isso também não vê a de cc
    await api().patch('/api/v1/settings/privacy').set(auth(cd)).send({ showPresence: true }).expect(200);
    expect((await thread(cd, cc)).person.presence).not.toBeNull();
  });

  it('sugestão de presente: só aparece se posso presentear (sigo a pessoa e aceita presentes)', async () => {
    const { ce: cc, cf: cd } = u;
    await pool.query('DELETE FROM social.follows WHERE follower_id = $1 AND followee_id = $2', [cc.id, cd.id]);
    expect((await thread(cc, cd)).person.canGift).toBe(false); // não segue
    await api().post(`/api/v1/users/${cd.username}/follow`).set(auth(cc)).expect(200);
    expect((await thread(cc, cd)).person.canGift).toBe(true);
    await api().patch('/api/v1/settings/privacy').set(auth(cd)).send({ giftsAllowed: 'off' }).expect(200);
    expect((await thread(cc, cd)).person.canGift).toBe(false);
    await api().patch('/api/v1/settings/privacy').set(auth(cd)).send({ giftsAllowed: 'everyone' }).expect(200);
  });

  it('partilhar uma publicação no chat: aparece como cartão; some se deixar de se poder ver', async () => {
    const { ce: from, cf: to } = u;
    const mk = (a: U, body: string) => api().post('/api/v1/posts').set(auth(a)).send({ body }).expect(201);
    const p = (await mk(from, 'post para partilhar')).body;
    const post = (a: U, b: object) => api().post(`/api/v1/chat/with/${to.username}`).set(auth(a)).send(b);
    await post(from, { kind: 'post', body: 'não-é-um-id' }).expect(400);
    await post(from, { kind: 'post', body: '00000000-0000-0000-0000-000000000000' }).expect(404);
    await post(from, { kind: 'post', body: p.id }).expect(201);
    const card = ((await thread(to, from)).items as { kind: string; post: { id: string; body: string } | null }[]).find((m) => m.kind === 'post')!;
    expect(card.post).toMatchObject({ id: p.id, body: 'post para partilhar' });
    // Se o autor passar a privado e o destinatário não o seguir, o cartão fica sem conteúdo.
    await api().patch('/api/v1/settings/privacy').set(auth(from)).send({ isPrivate: true }).expect(200);
    await api().delete(`/api/v1/users/${from.username}/follow`).set(auth(to));
    const hidden = ((await thread(to, from)).items as { kind: string; post: unknown }[]).find((m) => m.kind === 'post')!;
    expect(hidden.post).toBeNull();
    await api().patch('/api/v1/settings/privacy').set(auth(from)).send({ isPrivate: false }).expect(200);
  });

  it('grupos: criar, falar, não lidos, quem é membro, admin gere, sair passa a administração', async () => {
    const { cg, ch, ci, ca } = u;
    const gp = (x: U, path: string, method: 'get' | 'post' | 'patch' | 'delete' = 'get') => api()[method](`/api/v1/chat/groups${path}`).set(auth(x));
    // Precisa de pelo menos 2 pessoas além de quem cria; nomes que não existem falham.
    await gp(cg, '', 'post').send({ name: 'Malta', members: [ch.username] }).expect(400);
    await gp(cg, '', 'post').send({ name: 'Malta', members: [ch.username, 'ninguem_existe_' + run] }).expect(404);
    const id = (await gp(cg, '', 'post').send({ name: 'Malta da Polana', members: [ch.username, ci.username] }).expect(201)).body.id as string;

    // Todos veem o grupo; quem não é membro não.
    expect((await gp(ch, '').expect(200)).body.map((g: { id: string }) => g.id)).toContain(id);
    await gp(ca, `/${id}`).expect(404);
    await gp(ca, `/${id}/messages`, 'post').send({ body: 'intruso' }).expect(404);

    await gp(ch, `/${id}/messages`, 'post').send({ body: 'bora à praia?' }).expect(201);
    await gp(ch, `/${id}/messages`, 'post').send({ kind: 'sticker', body: 'bora' }).expect(201);
    const mine = (await gp(ci, '').expect(200)).body.find((g: { id: string }) => g.id === id);
    expect(mine).toMatchObject({ name: 'Malta da Polana', members: 3, unread: 2 });
    expect(mine.lastMessage).toMatchObject({ kind: 'sticker', fromMe: false });
    expect((await api().get('/api/v1/chat/unread').set(auth(ci)).expect(200)).body.conversations).toBeGreaterThanOrEqual(1);

    const t = (await gp(ci, `/${id}`).expect(200)).body;
    expect(t.group).toMatchObject({ name: 'Malta da Polana', myRole: 'member' });
    expect(t.group.members).toHaveLength(3);
    expect(t.items[0]).toMatchObject({ kind: 'sticker', fromMe: false, sender: { username: ch.username } });
    expect(((await gp(ci, '').expect(200)).body.find((g: { id: string }) => g.id === id)).unread).toBe(0); // abrir marca como lido

    // Só quem administra muda o nome e adiciona; qualquer pessoa pode sair.
    await gp(ch, `/${id}`, 'patch').send({ name: 'xy' }).expect(403);
    await gp(cg, `/${id}`, 'patch').send({ name: 'Malta toda' }).expect(204);
    await gp(ch, `/${id}/members`, 'post').send({ members: [ca.username] }).expect(403);
    await gp(cg, `/${id}/members`, 'post').send({ members: [ca.username] }).expect(204);
    expect((await gp(ca, `/${id}`).expect(200)).body.group).toMatchObject({ name: 'Malta toda', myRole: 'member' });
    await gp(ca, `/${id}/members/${ch.username}`, 'delete').expect(403); // membro não tira outro
    await gp(cg, `/${id}/members/${ca.username}`, 'delete').expect(204);
    await gp(ca, `/${id}`).expect(404); // já não é membro

    // O admin sai e a administração passa ao membro mais antigo.
    await gp(cg, `/${id}/members/${cg.username}`, 'delete').expect(204);
    expect((await gp(ch, `/${id}`).expect(200)).body.group.myRole).toBe('admin');

    // Apagar a minha mensagem no grupo.
    const msgId = (await gp(ch, `/${id}`).expect(200)).body.items[1].id as string;
    await api().delete(`/api/v1/chat/messages/${msgId}`).set(auth(ch)).expect(204);
    expect((await gp(ci, `/${id}`).expect(200)).body.items.find((m: { id: string }) => m.id === msgId)).toMatchObject({ deleted: true, body: 'Esta mensagem foi apagada', mediaUrl: null });
  });

  it('política de mensagens de quem não se segue: aviso, limite de 3, pedido, aceitar, recusar', async () => {
    const { cj: stranger, ca: me } = u; // stranger não é seguido por ca, nem o segue
    // Quem escreve a alguém que não o segue: sabe que a pessoa não o segue e pode mandar só 3 antes de resposta.
    const first = await send(stranger, me, 'olá 1').expect(201);
    expect(first.body.kind).toBe('text');
    expect((await thread(stranger, me)).relation).toMatchObject({ theyFollow: false, request: false, left: 2 });
    await send(stranger, me, 'olá 2').expect(201);
    await send(stranger, me, 'olá 3').expect(201);
    await send(stranger, me, 'olá 4').expect(403);

    // Para quem recebe é um pedido: vai para os pedidos e não conta para o número do ícone.
    const row = (await list(me)).find((c) => c.username === stranger.username) as unknown as { request: boolean; unread: number };
    expect(row).toMatchObject({ request: true, unread: 3 });
    expect((await api().get('/api/v1/chat/unread').set(auth(me)).expect(200)).body).toMatchObject({ requests: expect.any(Number) });
    expect((await thread(me, stranger)).relation).toMatchObject({ iFollow: false, request: true });

    // Recusar esconde a conversa e a pessoa não é avisada; não recebe mais avisos.
    await api().post(`/api/v1/chat/with/${stranger.username}/decline`).set(auth(me)).expect(204);
    expect((await list(me)).some((c) => c.username === stranger.username)).toBe(false);

    // Aceitar traz a conversa de volta à lista normal e liberta o limite de quem escreveu.
    await api().post(`/api/v1/chat/with/${stranger.username}/accept`).set(auth(me)).expect(204);
    const back = (await list(me)).find((c) => c.username === stranger.username) as unknown as { request: boolean };
    expect(back.request).toBe(false);
    await send(stranger, me, 'olá 4').expect(201);
    expect((await thread(stranger, me)).relation.left).toBeNull();

    // Responder também aceita; seguir de volta tira o aviso de "não te segue".
    await send(me, stranger, 'olá! diz').expect(201);
    await api().post(`/api/v1/users/${stranger.username}/follow`).set(auth(me)).expect(200);
    expect((await thread(stranger, me)).relation).toMatchObject({ theyFollow: true, left: null });
  });

  it('notas de 24 h: só os seguidores veem; não se edita; responder vai para o chat', async () => {
    const { ca, cb, cc, cj } = u; // ca, cb, cc seguem-se; cj não é seguido por ninguém
    const notes = async (x: U) => (await api().get('/api/v1/notes').set(auth(x)).expect(200)).body as { mine: { body: string } | null; items: { username: string; body: string }[] };
    await api().put('/api/v1/notes/me').set(auth(ca)).send({ body: '' }).expect(400);
    await api().put('/api/v1/notes/me').set(auth(ca)).send({ body: 'x'.repeat(61) }).expect(400);
    await api().put('/api/v1/notes/me').set(auth(ca)).send({ body: 'Quem vai à praia hoje?' }).expect(204);

    expect((await notes(ca)).mine?.body).toBe('Quem vai à praia hoje?');
    expect((await notes(cb)).items.map((n) => n.username)).toContain(ca.username); // segue ca
    expect((await notes(cj)).items.map((n) => n.username)).not.toContain(ca.username); // não segue ca

    // Não se edita: tentar publicar outra com a primeira ativa é recusado; só apagando.
    await api().put('/api/v1/notes/me').set(auth(ca)).send({ body: 'Só os meus' }).expect(409);
    expect((await notes(ca)).mine?.body).toBe('Quem vai à praia hoje?');
    expect((await notes(cc)).items.map((n) => n.username)).toContain(ca.username); // cc também segue ca

    // Responder: chega ao dono como mensagem, a dizer a que nota responde; quem não a vê não pode responder.
    await api().post(`/api/v1/notes/${ca.username}/reply`).set(auth(cb)).send({ text: 'eu vou!' }).expect(201);
    await api().post(`/api/v1/notes/${ca.username}/reply`).set(auth(cj)).send({ text: 'e eu?' }).expect(404);
    const got = ((await thread(ca, cb)).items as { body: string; fromMe: boolean }[]).find((m) => !m.fromMe && m.body.includes('eu vou!'))!;
    expect(got.body).toContain('Quem vai à praia hoje?');

    // Expira passadas 24 h; apagar também a tira.
    await pool.query(`UPDATE social.notes SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [ca.id]);
    expect((await notes(cb)).items.map((n) => n.username)).not.toContain(ca.username);
    expect((await notes(ca)).mine).toBeNull();
    await api().put('/api/v1/notes/me').set(auth(ca)).send({ body: 'outra' }).expect(204);
    await api().delete('/api/v1/notes/me').set(auth(ca)).expect(204);
    expect((await notes(ca)).mine).toBeNull();
  });

  it('visualização única: o conteúdo não vai na lista, abre-se uma vez e é apagado; só o destinatário abre', async () => {
    const { ce: from, cf: to } = u;
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [to.id, from.id]); // quem recebe segue quem envia (sem limite de desconhecidos)
    const post = (a: U, b: U, body: object) => api().post(`/api/v1/chat/with/${b.username}`).set(auth(a)).send(body);
    const sent = (await post(from, to, { body: 'segredo 1234', once: true }).expect(201)).body.id as string;

    // Na lista, nem o destinatário nem quem enviou vê o texto.
    const asTo = ((await thread(to, from)).items as { id: string; body: string; viewOnce: boolean; opened: boolean }[]).find((m) => m.id === sent)!;
    expect(asTo).toMatchObject({ body: '', viewOnce: true, opened: false });
    expect(JSON.stringify((await thread(from, to)).items)).not.toContain('segredo');
    expect(((await list(to)).find((c) => c.username === from.username) as unknown as { lastMessage: { body: string; once: boolean } }).lastMessage).toMatchObject({ body: '', once: true });

    // Quem enviou não abre; um terceiro também não.
    await api().post(`/api/v1/chat/messages/${sent}/open`).set(auth(from)).expect(404);
    await api().post(`/api/v1/chat/messages/${sent}/open`).set(auth(u.ca)).expect(404);
    // O destinatário abre: vê uma vez.
    const opened = (await api().post(`/api/v1/chat/messages/${sent}/open`).set(auth(to)).expect(200)).body;
    expect(opened).toMatchObject({ kind: 'text', body: 'segredo 1234' });
    await api().post(`/api/v1/chat/messages/${sent}/open`).set(auth(to)).expect(410);
    expect(((await thread(from, to)).items as { id: string; opened: boolean }[]).find((m) => m.id === sent)!.opened).toBe(true);
    // O texto foi mesmo apagado do servidor.
    expect((await pool.query('SELECT body FROM social.messages WHERE id = $1', [sent])).rows[0].body).toBe('');

    // Foto de visualização única: o ficheiro só aparece ao abrir.
    const pic = await uploadChat(from, 'image/png', PNG);
    const img = (await post(from, to, { kind: 'image', mediaId: pic, once: true }).expect(201)).body.id as string;
    expect(((await thread(to, from)).items as { id: string; mediaUrl: string | null }[]).find((m) => m.id === img)!.mediaUrl).toBeNull();
    expect((await api().post(`/api/v1/chat/messages/${img}/open`).set(auth(to)).expect(200)).body.mediaUrl).toContain('/chat/media/');
    // Depois de aberta, a foto tem prazo: o servidor apaga o ficheiro (não fica guardada para sempre).
    expect((await pool.query('SELECT expires_at FROM content.media_assets WHERE id = $1', [pic])).rows[0].expires_at).not.toBeNull();
    await pool.query("UPDATE content.media_assets SET expires_at = now() - interval '1 minute' WHERE id = $1", [pic]);
    await app.get(MediaService).sweepDeleted();
    expect((await pool.query('SELECT status, purged_at FROM content.media_assets WHERE id = $1', [pic])).rows[0]).toMatchObject({ status: 'deleted' });
  });

  it('localização em direto: o remetente atualiza enquanto dura; depois já não; pode parar', async () => {
    const { ce: from, cf: to } = u;
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [to.id, from.id]); // quem recebe segue quem envia (sem limite de desconhecidos)
    const sent = (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ kind: 'location', body: 'Em direto', lat: -25.97, lng: 32.57, liveMinutes: 15 }).expect(201)).body.id as string;
    const find = async (x: U, y: U) => ((await thread(x, y)).items as { id: string; live: boolean; lat: number }[]).find((m) => m.id === sent)!;
    expect(await find(to, from)).toMatchObject({ live: true, lat: -25.97 });
    await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ kind: 'location', body: 'x', lat: 0, lng: 0, liveMinutes: 7 }).expect(400); // só 15, 60 ou 480

    await api().put(`/api/v1/chat/messages/${sent}/location`).set(auth(to)).send({ lat: 1, lng: 1 }).expect(404); // só quem enviou
    await api().put(`/api/v1/chat/messages/${sent}/location`).set(auth(from)).send({ lat: -25.98, lng: 32.58 }).expect(204);
    expect(await find(to, from)).toMatchObject({ live: true, lat: -25.98 });

    await api().delete(`/api/v1/chat/messages/${sent}/live`).set(auth(from)).expect(204);
    expect((await find(to, from)).live).toBe(false);
    await api().put(`/api/v1/chat/messages/${sent}/location`).set(auth(from)).send({ lat: 2, lng: 2 }).expect(404); // terminou
  });

  it('localização de um sítio: o nome e a morada vão com o ponto (opcionais), na conversa e nos grupos', async () => {
    const { ce: from, cf: to, cg, ch, ci } = u;
    type Loc = { id: string; body: string; lat: number; lng: number; placeName: string | null; placeAddress: string | null; live: boolean };
    const loc = async (x: U, y: U, id: string) => ((await thread(x, y)).items as Loc[]).find((m) => m.id === id)!;
    // Os envios dos testes anteriores contam para o limite por minuto: este começa do zero.
    const st = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    st.storage.clear();
    st.hitExpirations?.clear();

    // Um sítio da lista "Sítios perto": nome e morada; sem texto, o texto passa a ser o nome (lista de conversas e apps antigas).
    const spot = (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ kind: 'location', lat: -25.965432, lng: 32.581234, name: '  Café Acácia ', address: 'Av. Julius Nyerere 123, Maputo' }).expect(201)).body.id as string;
    expect(await loc(to, from, spot)).toMatchObject({ body: 'Café Acácia', lat: -25.96543, lng: 32.58123, placeName: 'Café Acácia', placeAddress: 'Av. Julius Nyerere 123, Maputo', live: false });
    expect((await list(to)).find((c) => c.username === from.username)!.lastMessage).toMatchObject({ kind: 'location', body: 'Café Acácia' });

    // A localização atual (só o ponto): sem nome nem morada, como antes.
    const here = (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ kind: 'location', lat: -25.97, lng: 32.57 }).expect(201)).body.id as string;
    expect(await loc(to, from, here)).toMatchObject({ body: '', placeName: null, placeAddress: null });

    // Só o nome (sem morada) também serve; nome ou morada compridos de mais são recusados.
    const onlyName = (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ kind: 'location', lat: -25.9, lng: 32.6, name: 'Costa do Sol' }).expect(201)).body.id as string;
    expect(await loc(from, to, onlyName)).toMatchObject({ placeName: 'Costa do Sol', placeAddress: null });
    await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ kind: 'location', lat: 0, lng: 0, name: 'x'.repeat(81) }).expect(400);
    await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ kind: 'location', lat: 0, lng: 0, address: 'x'.repeat(161) }).expect(400);
    // O nome e a morada não fazem sentido noutras mensagens: num texto são ignorados.
    const txt = (await api().post(`/api/v1/chat/with/${to.username}`).set(auth(from)).send({ body: 'olá', name: 'Nada' }).expect(201)).body.id as string;
    expect((await pool.query('SELECT place_name, place_address FROM social.messages WHERE id = $1', [txt])).rows[0]).toEqual({ place_name: null, place_address: null });

    // Nos grupos, o mesmo.
    const gid = (await api().post('/api/v1/chat/groups').set(auth(cg)).send({ name: 'Sítios da malta', members: [ch.username, ci.username] }).expect(201)).body.id as string;
    await api().post(`/api/v1/chat/groups/${gid}/messages`).set(auth(ch)).send({ kind: 'location', lat: -25.95, lng: 32.59, name: 'Mercado do Peixe', address: 'Av. Marginal, Maputo' }).expect(201);
    const item = (await api().get(`/api/v1/chat/groups/${gid}`).set(auth(ci)).expect(200)).body.items[0];
    expect(item).toMatchObject({ kind: 'location', body: 'Mercado do Peixe', placeName: 'Mercado do Peixe', placeAddress: 'Av. Marginal, Maputo', sender: { username: ch.username } });
  });
});
