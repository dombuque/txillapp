import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { arcPoints, zasCaptionSvg } from './zas-caption';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const W = 600, H = 800;
const GRAY = 100;

interface U { token: string; id: string; username: string }

/** Lê a resposta binária (a cópia guardada) como Buffer. */
const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
};

/** O canal mais claro numa zona da imagem (a assinatura e a legenda são brancas; a foto de teste é cinzenta). */
async function brightest(img: Buffer, left: number, top: number, width: number, height: number): Promise<number> {
  const px = await sharp(img).extract({ left, top, width, height }).removeAlpha().raw().toBuffer();
  let max = 0;
  for (const v of px) if (v > max) max = v;
  return max;
}

describe('guardar um Zás: só o dono, com a assinatura e a legenda (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let jpeg: Buffer;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function makeZas(a: U, caption = '') {
    const up = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/jpeg', size: jpeg.length, purpose: 'chat' }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    await api().post(`/api/v1/media/${up.body.assetId}/complete`).set(auth(a)).send({}).expect(200);
    return (await api().post('/api/v1/instants').set(auth(a)).send({ mediaId: up.body.assetId, caption }).expect(201)).body.id as string;
  }
  const get = (x: U, id: string) => api().get(`/api/v1/instants/${id}/download`).set(auth(x)).buffer(true).parse(binary as never);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'z'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    jpeg = await sharp({ create: { width: W, height: H, channels: 3, background: { r: GRAY, g: GRAY, b: GRAY } } }).jpeg({ quality: 90 }).toBuffer();
    for (const n of ['zsa', 'zsb', 'zsc']) u[n] = await signup(n);
    // zsa e zsb seguem-se: zsb vê os Zás da zsa, mas nem assim os pode guardar.
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [u.zsa.id, u.zsb.id]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o dono recebe o JPEG assinado (logótipo e @ em baixo à direita) e com a legenda na curva', async () => {
    const id = await makeZas(u.zsa, 'cheguei ao Tofo');
    const r = await get(u.zsa, id).expect(200);
    expect(r.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="txillapp-zas-.+\.jpg"/);
    expect(r.headers['cache-control']).toMatch(/no-store/);
    const out = r.body as Buffer;
    expect(Buffer.compare(out, jpeg)).not.toBe(0);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([W, H]);
    // O original é cinzento por igual: a assinatura (branca) acende o canto de baixo à direita...
    expect(await brightest(jpeg, 420, 680, 170, 110)).toBeLessThan(GRAY + 15);
    expect(await brightest(out, 420, 680, 170, 110)).toBeGreaterThan(200);
    // ... e a legenda acende o troço da curva do lado esquerdo e do topo (onde corre no ecrã).
    const p = arcPoints(W, H)[40];
    expect(await brightest(out, Math.max(0, Math.round(p.x) - 30), Math.max(0, Math.round(p.y) - 30), 60, 60)).toBeGreaterThan(200);
    // O meio da foto fica como estava.
    expect(await brightest(out, 250, 350, 100, 100)).toBeLessThan(GRAY + 15);
  });

  it('sem legenda sai só a assinatura (a curva fica como a foto)', async () => {
    const id = await makeZas(u.zsa);
    const out = (await get(u.zsa, id).expect(200)).body as Buffer;
    expect(await brightest(out, 420, 680, 170, 110)).toBeGreaterThan(200);
    const p = arcPoints(W, H)[40];
    expect(await brightest(out, Math.round(p.x) - 30, Math.round(p.y) - 30, 60, 60)).toBeLessThan(GRAY + 15);
  });

  it('o Zás de outra pessoa não se guarda (403), nem para quem o pode ver', async () => {
    const id = await makeZas(u.zsa, 'só meu');
    await get(u.zsb, id).expect(403);
    await get(u.zsc, id).expect(403);
    await api().get(`/api/v1/instants/${id}/download`).expect(401);
  });

  it('apagado, expirado ou inexistente: 404', async () => {
    const gone = await makeZas(u.zsa, 'vai-se');
    await get(u.zsa, gone).expect(200);
    await api().delete(`/api/v1/instants/${gone}`).set(auth(u.zsa)).expect(204);
    await get(u.zsa, gone).expect(404);
    await get(u.zsb, gone).expect(404);

    const old = await makeZas(u.zsa, 'ontem');
    await pool.query(`UPDATE social.instants SET expires_at = now() - interval '1 minute' WHERE id = $1`, [old]);
    await get(u.zsa, old).expect(404);

    await get(u.zsa, '00000000-0000-4000-8000-000000000000').expect(404);
    await get(u.zsa, 'nao-e-um-id').expect(400);
  });

  it('a legenda: maiúsculas, uma letra de cada vez ao longo da curva, e escapada no SVG', () => {
    expect(zasCaptionSvg(W, H, '   ')).toBe('');
    const svg = zasCaptionSvg(W, H, 'Olá <b>&');
    expect(svg).toContain('>L<');
    expect(svg).toContain('>Á<');
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&amp;');
    expect(svg).not.toContain('<b>');
    // Duas camadas (contorno e letra) com os 7 sinais visíveis cada (o espaço não se desenha).
    expect(svg.match(/<text /g)).toHaveLength(14);
    // Legenda muito comprida: encolhe para caber, mas nunca abaixo do mínimo do ecrã (8 px numa foto de 300).
    const fs = Number(/font-size="([\d.]+)"/.exec(zasCaptionSvg(W, H, 'x'.repeat(80)))![1]);
    expect(fs).toBeGreaterThanOrEqual(16);
  });
});
