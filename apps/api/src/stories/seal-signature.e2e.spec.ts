import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { SEAL_PATH, signLayout, signatureSvg } from '../media/signature';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const SIDE = 600;
const GRAY = 100;

/** A conta da app (apps/mobile/src/lib/wordmark.ts), compilada aqui para comparar (fica fora do src da API). */
function appModule(): { signLayout: typeof signLayout } {
  const src = readFileSync(join(__dirname, '..', '..', '..', 'mobile', 'src', 'lib', 'wordmark.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports as { signLayout: typeof signLayout };
}
const appLayout = appModule().signLayout;

interface U { token: string; id: string; username: string }

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
};

/** A zona do selo numa foto de 600×600 (à direita do @), com a cor que mais se afasta do cinzento em azul e em coral. */
async function sealZone(img: Buffer) {
  const b = signLayout(SIDE, SIDE, true, 'verified').seal!;
  // O meio da roseta (o visto branco fica de fora: só os cantos de dentro da caixa).
  const left = Math.round(b.x + b.size * 0.15), top = Math.round(b.y + b.size * 0.15), size = Math.round(b.size * 0.7);
  const px = await sharp(img).extract({ left, top, width: size, height: size }).removeAlpha().raw().toBuffer();
  let blue = 0, coral = 0;
  for (let i = 0; i < px.length; i += 3) {
    const [r, , bl] = [px[i], px[i + 1], px[i + 2]];
    blue = Math.max(blue, bl - r);
    coral = Math.max(coral, r - bl);
  }
  return { blue, coral };
}

describe('o selo de verificado na assinatura das fotos e vídeos guardados', () => {
  it('a conta da posição é a mesma da app (lib/wordmark.ts), com e sem selo', () => {
    for (const [W, H] of [[1080, 1920], [1080, 1350], [600, 600], [1920, 1080], [375, 667]]) {
      for (const withUser of [true, false]) {
        for (const seal of [null, 'verified', 'official', 'paid'] as const) {
          expect(signLayout(W, H, withUser, seal)).toEqual(appLayout(W, H, withUser, seal));
        }
      }
    }
  });

  it('o selo vai encostado à direita, a seguir ao @, com 1,05× a letra; sem selo o @ acaba na margem', () => {
    const plain = signLayout(1080, 1920, true);
    expect(plain.seal).toBeNull();
    expect(plain.textRight).toBe(plain.right);
    const L = signLayout(1080, 1920, true, 'verified');
    const b = L.seal!;
    expect(b.size).toBeCloseTo(L.userSize * 1.05, 9);
    expect(b.x + b.size).toBeCloseTo(L.right, 9);
    expect(L.textRight).toBeLessThan(b.x);
    expect(b.x - L.textRight).toBeCloseTo(L.userSize * 0.15, 9);
    // Sem @ não há selo.
    expect(signLayout(1080, 1920, false, 'verified').seal).toBeNull();
  });

  const CORAL_GRAD = '<linearGradient id="seal-coral" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b81"/><stop offset="1" stop-color="#d6334f"/></linearGradient>';

  it('signatureSvg: conta verificada leva o path do selo (coral); não verificada não leva', () => {
    const on = signatureSvg(1080, 1920, 'dombuque', '', true, 'verified');
    expect(on).toContain(SEAL_PATH);
    expect(on).toContain('fill="url(#seal-coral)"');
    expect(on).toContain(CORAL_GRAD);
    expect(on).not.toContain('#1d9bf0');
    expect(on).toContain('d="m8 12.4 2.8 2.8L16.4 9.4"');
    // O @ acaba antes do selo.
    expect(on).toContain(`x="${signLayout(1080, 1920, true, 'verified').textRight}"`);
    const off = signatureSvg(1080, 1920, 'dombuque', '', true, null);
    expect(off).not.toContain(SEAL_PATH);
    expect(off).not.toContain('#1d9bf0');
    expect(signatureSvg(1080, 1920, 'dombuque')).toBe(off);
    // A conta oficial: o mesmo degradê coral do VerifiedBadge.
    const official = signatureSvg(1080, 1920, 'txillapp', '', true, 'official');
    expect(official).toContain(SEAL_PATH);
    expect(official).toContain('fill="url(#seal-coral)"');
    expect(official).toContain(CORAL_GRAD);
    expect(official).not.toContain('#1d9bf0');
    // A verificação paga: só esta é azul, sem degradê.
    const paid = signatureSvg(1080, 1920, 'dombuque', '', true, 'paid');
    expect(paid).toContain(SEAL_PATH);
    expect(paid).toContain('fill="#1d9bf0"');
    expect(paid).not.toContain('seal-coral');
    expect(paid).not.toContain('#ff6b81');
    // Já assinado pela app (withSign a false): nada da assinatura, nem o selo.
    expect(signatureSvg(1080, 1920, 'dombuque', '', false, 'verified')).not.toContain(SEAL_PATH);
    // Sem @ não há selo.
    expect(signatureSvg(1080, 1920, null, '', true, 'verified')).not.toContain(SEAL_PATH);
  });

  describe('integração: guardar um mimo', () => {
    let app: INestApplication;
    let pool: Pool;
    let jpeg: Buffer;
    const run = Date.now().toString(36);
    const api = () => request(app.getHttpServer());
    const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

    async function signup(name: string): Promise<U> {
      const username = `${name}${run}`.slice(0, 28);
      const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
      return { token: r.body.accessToken, id: r.body.user.id, username };
    }
    const badge = (x: U, tier: 'verified' | 'official' | 'paid' | null) =>
      pool.query('UPDATE identity.users SET verified = $2, verified_tier = $3 WHERE id = $1', [x.id, tier !== null, tier]);
    async function saved(x: U, extra: Record<string, unknown> = {}): Promise<Buffer> {
      const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/jpeg', size: jpeg.length, ...extra }).expect(201);
      await api().put(up.body.uploadUrl).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
      const story = (await api().post('/api/v1/stories').set(auth(x)).send({ mediaId: up.body.assetId }).expect(201)).body;
      const r = await api().get(`/api/v1/stories/${story.id}/download`).set(auth(x)).buffer(true).parse(binary as never).expect(200);
      return r.body as Buffer;
    }

    beforeAll(async () => {
      await migrate(DB);
      pool = new Pool({ connectionString: DB });
      app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
      await app.init();
      jpeg = await sharp({ create: { width: SIDE, height: SIDE, channels: 3, background: { r: GRAY, g: GRAY, b: GRAY } } }).jpeg({ quality: 95 }).toBuffer();
    }, 60_000);

    afterAll(async () => {
      await app.close();
      await pool.end();
    });

    it('a sessão (/auth/me e o login) diz se a conta é verificada e qual o selo', async () => {
      const u = await signup('selome');
      const me0 = (await api().get('/api/v1/auth/me').set(auth(u)).expect(200)).body;
      expect(me0).toMatchObject({ id: u.id, username: u.username, verified: false, verifiedTier: null });
      await badge(u, 'official');
      const me1 = (await api().get('/api/v1/auth/me').set(auth(u)).expect(200)).body;
      expect(me1).toMatchObject({ verified: true, verifiedTier: 'official' });
      const login = (await api().post('/api/v1/auth/login').send({ identifier: u.username, password: PASSWORD }).expect(200)).body;
      expect(login.user).toEqual({ id: u.id, username: u.username, displayName: 'selome Teste', verified: true, verifiedTier: 'official' });
    });

    it('conta não verificada: à direita do @ não há selo (nem azul nem coral)', async () => {
      const u = await signup('selono');
      const z = await sealZone(await saved(u));
      expect(z.blue).toBeLessThan(20);
      expect(z.coral).toBeLessThan(20);
    });

    it('conta verificada (mérito ou pedido aceite): o selo coral à direita do @', async () => {
      const u = await signup('selover');
      await badge(u, 'verified');
      const z = await sealZone(await saved(u));
      expect(z.coral).toBeGreaterThan(120);
      expect(z.blue).toBeLessThan(20);
    });

    it('verificação paga: o selo azul à direita do @', async () => {
      const u = await signup('seloaz');
      await badge(u, 'paid');
      const z = await sealZone(await saved(u));
      expect(z.blue).toBeGreaterThan(120);
      expect(z.coral).toBeLessThan(20);
    });

    it('conta oficial: o selo coral à direita do @', async () => {
      const u = await signup('selooff');
      await badge(u, 'official');
      const z = await sealZone(await saved(u));
      expect(z.coral).toBeGreaterThan(120);
      expect(z.blue).toBeLessThan(20);
    });

    it('ficheiro já assinado pela app: o servidor não junta o selo (vem da app)', async () => {
      const u = await signup('seloapp');
      await badge(u, 'verified');
      const z = await sealZone(await saved(u, { signed: true }));
      expect(z.blue).toBeLessThan(20);
      expect(z.coral).toBeLessThan(20);
    });
  });
});
