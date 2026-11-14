import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { zasCaptionSvg } from '../instants/zas-caption';
import { stickersSvg } from './stickers';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const SIDE = 600;
const GRAY = 100;

interface U { token: string; id: string; username: string }
type Post = { id: string; textFont: string | null; body: string; repostOf: Post | null };

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
};

/** A média de cada canal numa zona da imagem. */
async function mean(img: Buffer, left: number, top: number, width: number, height: number): Promise<number> {
  const px = await sharp(img).extract({ left, top, width, height }).removeAlpha().raw().toBuffer();
  let s = 0;
  for (const v of px) s += v;
  return s / px.length;
}

/** docs/fontes-contrato.md: textos nos mimos, letra das publicações só com texto e da legenda do Zás. */
describe('fontes ao publicar (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let jpeg: Buffer;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  let me: U;
  let friend: U;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(x: U, extra: Record<string, unknown> = {}): Promise<string> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/jpeg', size: jpeg.length, ...extra }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    return up.body.assetId as string;
  }
  async function chatPhoto(x: U): Promise<string> {
    const id = await upload(x, { purpose: 'chat' });
    await api().post(`/api/v1/media/${id}/complete`).set(auth(x)).send({}).expect(200);
    return id;
  }
  const text = (o: Record<string, unknown> = {}) => ({ kind: 'text', text: 'Bom dia malta', font: 'cartaz', color: '#ffd60a', bg: 'solid', align: 'center', x: 0.5, y: 0.5, s: 0.6, r: -5, ...o });
  const emoji = { id: 'm-fogo', x: 0.2, y: 0.8, s: 0.25, r: 12 };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    me = await signup('fnt');
    friend = await signup('fntb');
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [me.id, friend.id]);
    jpeg = await sharp({ create: { width: SIDE, height: SIDE, channels: 3, background: { r: GRAY, g: GRAY, b: GRAY } } }).jpeg({ quality: 95 }).toBuffer();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('textos por cima dos mimos', () => {
    it('guarda textos ao lado dos stickers e devolve-os iguais (com os valores por omissão preenchidos)', async () => {
      const layers = [emoji, text(), { kind: 'text', text: '  duas\nlinhas ', x: 0.5, y: 0.2, s: 0.4, r: 0 }];
      const media1 = await upload(me);
      const story = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: media1, stickers: layers }).expect(201)).body;
      const expected = [emoji, text(), { kind: 'text', text: 'duas\nlinhas', font: 'classica', color: '#ffffff', bg: 'none', align: 'center', x: 0.5, y: 0.2, s: 0.4, r: 0 }];
      expect(story.stickers).toEqual(expected);
      const seen = (await api().get(`/api/v1/stories/user/${me.username}`).set(auth(friend)).expect(200)).body as { id: string; stickers: unknown }[];
      expect(seen.find((s) => s.id === story.id)?.stickers).toEqual(expected);
    });

    it('os stickers de sempre (sem `kind`) continuam aceites e iguais', async () => {
      const media2 = await upload(me);
      const story = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: media2, stickers: [emoji] }).expect(201)).body;
      expect(story.stickers).toEqual([emoji]);
    });

    it('recusa textos inválidos com 400', async () => {
      const m = await upload(me);
      const bad = [
        text({ text: '   ' }),
        text({ text: 'x'.repeat(151) }),
        text({ text: '1\n2\n3\n4\n5\n6\n7' }),
        text({ text: 'olá\u0007' }),
        text({ font: 'comic-sans' }),
        text({ color: 'amarelo' }),
        text({ bg: 'pano' }),
        text({ align: 'justify' }),
        text({ x: 3 }),
        text({ s: 5 }),
        { kind: 'video', text: 'x', x: 0.5, y: 0.5, s: 0.5, r: 0 },
      ];
      for (const l of bad) await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m, stickers: [l] }).expect(400);
    });

    it('limites: até 10 textos mais os 12 stickers', async () => {
      const m = await upload(me);
      const texts = (n: number) => Array.from({ length: n }, (_, i) => text({ text: `texto ${i}` }));
      await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m, stickers: [...texts(11)] }).expect(400);
      await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m, stickers: [...Array(13).fill(emoji), text()] }).expect(400);
      const full = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m, stickers: [...Array(12).fill(emoji), ...texts(10)] }).expect(201)).body;
      expect(full.stickers).toHaveLength(22);
    });

    it('o texto passa pelo filtro das legendas', async () => {
      const media3 = await upload(me);
      await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: media3, stickers: [text({ text: 'Vou-te matar amanhã' })] }).expect(422);
    });

    it('partilhar uma publicação no mimo também leva textos', async () => {
      const media4 = await upload(me);
      const post = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'foto', mediaIds: [media4] }).expect(201)).body;
      const shared = (await api().post('/api/v1/stories/share').set(auth(me)).send({ postId: post.id, stickers: [text({ font: 'praia' })] }).expect(201)).body;
      expect(shared.stickers).toEqual([text({ font: 'praia' })]);
      await api().post('/api/v1/stories/share').set(auth(me)).send({ postId: post.id, stickers: [text({ font: 'xpto' })] }).expect(400);
      await api().post('/api/v1/stories/share').set(auth(me)).send({ postId: post.id, stickers: [text({ text: 'mata-te' })] }).expect(422);
    });

    it('a cópia guardada leva o texto gravado: a caixa cheia aparece no sítio, com a cor', async () => {
      // Uma caixa branca larga no meio, sem rotação; o resto da foto continua cinzento.
      const media5 = await upload(me);
      const story = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: media5, stickers: [text({ text: 'MMMM', color: '#ffffff', bg: 'solid', s: 0.8, r: 0, font: 'grito' })] }).expect(201)).body;
      const r = await api().get(`/api/v1/stories/${story.id}/download`).set(auth(me)).buffer(true).parse(binary as never).expect(200);
      const img = r.body as Buffer;
      // Perto da borda esquerda da caixa (dentro da margem, onde não há letras): branco.
      expect(await mean(img, Math.round(SIDE * 0.13), SIDE / 2 - 4, 8, 8)).toBeGreaterThan(235);
      // Acima da caixa: a foto como estava.
      expect(Math.abs((await mean(img, SIDE / 2 - 10, 30, 20, 20)) - GRAY)).toBeLessThan(8);
    });

    it('stickersSvg desenha os textos como imagem, rodados à volta do centro', () => {
      const svg = stickersSvg(1080, 1920, [text({ r: 15, x: 0.5, y: 0.25 }) as never]);
      expect(svg).toContain('rotate(15.00 540.00 480.00)');
      expect(svg).toMatch(/<image [^>]*href="data:image\/png;base64,/);
    });
  });

  describe('publicações só com texto', () => {
    const one = async (x: U, id: string) => (await api().get(`/api/v1/posts/${id}`).set(auth(x)).expect(200)).body as Post;

    it('guarda a letra numa publicação sem ficheiros e devolve-a em todo o lado', async () => {
      const p = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'só texto', textFont: 'retro' }).expect(201)).body as Post;
      expect(p.textFont).toBe('retro');
      expect((await one(friend, p.id)).textFont).toBe('retro');
      const profile = (await api().get(`/api/v1/users/${me.username}/posts?tab=posts`).set(auth(friend)).expect(200)).body.items as Post[];
      expect(profile.find((x) => x.id === p.id)?.textFont).toBe('retro');
      const feed = (await api().get('/api/v1/posts?limit=50').set(auth(friend)).expect(200)).body.items as Post[];
      expect(feed.find((x) => x.id === p.id)?.textFont).toBe('retro');
    });

    it('sem letra: null; com fotos ou vídeos a letra ignora-se; fonte desconhecida: 400', async () => {
      expect(((await api().post('/api/v1/posts').set(auth(me)).send({ body: 'normal' }).expect(201)).body as Post).textFont).toBeNull();
      const media6 = await upload(me);
      const withPhoto = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'foto', mediaIds: [media6], textFont: 'grito' }).expect(201)).body as Post;
      expect(withPhoto.textFont).toBeNull();
      await api().post('/api/v1/posts').set(auth(me)).send({ body: 'x', textFont: 'comic' }).expect(400);
    });

    it('editar muda a letra (null volta à de sempre); numa publicação com foto não muda', async () => {
      const p = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'para editar', textFont: 'mao' }).expect(201)).body as Post;
      expect(((await api().patch(`/api/v1/posts/${p.id}`).set(auth(me)).send({ textFont: 'futuro' }).expect(200)).body as Post).textFont).toBe('futuro');
      expect(((await api().patch(`/api/v1/posts/${p.id}`).set(auth(me)).send({ body: 'outro texto' }).expect(200)).body as Post).textFont).toBe('futuro');
      expect(((await api().patch(`/api/v1/posts/${p.id}`).set(auth(me)).send({ textFont: null }).expect(200)).body as Post).textFont).toBeNull();
      await api().patch(`/api/v1/posts/${p.id}`).set(auth(me)).send({ textFont: 'nada' }).expect(400);
      const media7 = await upload(me);
      const photo = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'foto', mediaIds: [media7] }).expect(201)).body as Post;
      expect(((await api().patch(`/api/v1/posts/${photo.id}`).set(auth(me)).send({ textFont: 'grito' }).expect(200)).body as Post).textFont).toBeNull();
    });

    it('citações levam a sua letra e o original aparece com a dele; o repost simples fica sem', async () => {
      const original = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'original', textFont: 'elegante' }).expect(201)).body as Post;
      const quote = (await api().post(`/api/v1/posts/${original.id}/repost`).set(auth(friend)).send({ body: 'olha isto', textFont: 'maquina' }).expect(201)).body as Post;
      expect(quote.textFont).toBe('maquina');
      expect(quote.repostOf?.textFont).toBe('elegante');
      const plain = (await api().post(`/api/v1/posts/${original.id}/repost`).set(auth(friend)).send({ textFont: 'maquina' }).expect(201)).body as Post;
      expect(plain.textFont).toBeNull();
      expect(plain.repostOf?.textFont).toBe('elegante');
      await api().post(`/api/v1/posts/${original.id}/repost`).set(auth(friend)).send({ body: 'x', textFont: 'nada' }).expect(400);
    });

    it('um id desconhecido na base de dados lê-se como clássica', async () => {
      const p = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'antiga' }).expect(201)).body as Post;
      await pool.query(`UPDATE content.posts SET text_font = 'fonte-que-saiu' WHERE id = $1`, [p.id]);
      expect((await one(me, p.id)).textFont).toBe('classica');
    });

    it('a exportação dos dados leva a letra', async () => {
      const p = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'para exportar', textFont: 'cartaz' }).expect(201)).body as Post;
      const r = await api().get('/api/v1/me/export').set(auth(me)).expect(200);
      const data = JSON.parse(r.text) as { posts: { id: string; textFont: string | null }[] };
      expect(data.posts.find((x) => x.id === p.id)?.textFont).toBe('cartaz');
    });
  });

  describe('legenda do Zás', () => {
    type Zas = { id: string; caption: string; captionFont: string | null };

    it('guarda a letra da legenda e devolve-a no visor e na lista da pessoa', async () => {
      const media8 = await chatPhoto(me);
      const made = (await api().post('/api/v1/instants').set(auth(me)).send({ mediaId: media8, caption: 'no Tofo', captionFont: 'praia' }).expect(201)).body;
      expect(made.captionFont).toBe('praia');
      const feed = (await api().get('/api/v1/instants/feed').set(auth(friend)).expect(200)).body as (Zas & { author: unknown })[];
      expect(feed.find((z) => z.id === made.id)?.captionFont).toBe('praia');
      const mine = (await api().get(`/api/v1/instants/of/${me.username}`).set(auth(me)).expect(200)).body as Zas[];
      expect(mine.find((z) => z.id === made.id)?.captionFont).toBe('praia');
    });

    it('sem legenda ou sem letra: null; letra desconhecida: 400', async () => {
      const media9 = await chatPhoto(me);
      const noCaption = (await api().post('/api/v1/instants').set(auth(me)).send({ mediaId: media9, captionFont: 'grito' }).expect(201)).body;
      expect(noCaption.captionFont).toBeNull();
      const media10 = await chatPhoto(me);
      const noFont = (await api().post('/api/v1/instants').set(auth(me)).send({ mediaId: media10, caption: 'olá' }).expect(201)).body;
      expect(noFont.captionFont).toBeNull();
      const media11 = await chatPhoto(me);
      await api().post('/api/v1/instants').set(auth(me)).send({ mediaId: media11, caption: 'olá', captionFont: 'nada' }).expect(400);
    });

    it('a cópia guardada do Zás desenha a legenda com a letra escolhida', async () => {
      const media12 = await chatPhoto(me);
      const made = (await api().post('/api/v1/instants').set(auth(me)).send({ mediaId: media12, caption: 'cheguei', captionFont: 'grito' }).expect(201)).body;
      const r = await api().get(`/api/v1/instants/${made.id}/download`).set(auth(me)).buffer(true).parse(binary as never).expect(200);
      expect(r.headers['content-type']).toMatch(/^image\/jpeg/);
      // Sem letra: as letras em SVG (a de sempre); com letra: a imagem desenhada com a fonte do estúdio.
      expect(zasCaptionSvg(600, 800, 'cheguei')).toContain('<text');
      const svg = zasCaptionSvg(600, 800, 'cheguei', 'grito');
      expect(svg).toMatch(/^<image [^>]*href="data:image\/png;base64,/);
      expect(zasCaptionSvg(600, 800, '   ', 'grito')).toBe('');
    });
  });
});
