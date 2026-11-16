import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { signVideo } from './signature';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const MEDIA_DIR = './uploads-test';

/**
 * A matriz da pista de vÃ­deo (tkhd), como um telemÃ³vel a escreve: 16.16 para a, b, c, d; 2.30 para w. `cw90` Ã© o iPhone ou o
 * Android de pÃ© (frames 1920Ã—1080, mostrados rodados 90Â° no sentido do relÃ³gio); `transpose` Ã© a frontal com espelho.
 */
const MATRIX: Record<string, number[]> = {
  cw90: [0, 65536, 0, -65536, 0, 0, 180 << 16, 0, 1 << 30],
  ccw90: [0, -65536, 0, 65536, 0, 0, 0, 320 << 16, 1 << 30],
  r180: [-65536, 0, 0, 0, -65536, 0, 320 << 16, 180 << 16, 1 << 30],
  transpose: [0, 65536, 0, 65536, 0, 0, 0, 0, 1 << 30],
};

/** Escreve a matriz na tkhd da pista de vÃ­deo (a que tem largura) de um MP4/MOV. */
function withMatrix(file: Buffer, m: number[]): Buffer {
  const out = Buffer.from(file);
  for (let i = out.indexOf('tkhd'); i >= 0; i = out.indexOf('tkhd', i + 4)) {
    const at = i + (out[i + 4] === 1 ? 56 : 44); // versÃ£o 1: tempos de 64 bits
    if (out.readUInt32BE(at + 36) === 0) continue; // a pista do som nÃ£o tem largura
    m.forEach((x, k) => out.writeInt32BE(x, at + 4 * k));
    return out;
  }
  throw new Error('sem pista de vÃ­deo');
}

/** Um vÃ­deo deitado de 320Ã—180 (azul, com o quarto de cima Ã  esquerda vermelho), com som, e a matriz pedida. */
function rotatedVideo(name: keyof typeof MATRIX, ext: 'mp4' | 'mov') {
  const dir = mkdtempSync(join(tmpdir(), 'txill-rot-'));
  const file = join(dir, `base.${ext}`);
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=15:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-vf', 'drawbox=x=0:y=0:w=160:h=90:color=red:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { stdio: 'ignore' });
  return withMatrix(readFileSync(file), MATRIX[name]);
}

type Stream = { width: number; height: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] };
function videoStream(file: string): Stream {
  const out = execFileSync(ffprobe.path, ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', file]).toString();
  return (JSON.parse(out) as { streams: Stream[] }).streams[0];
}
const rotationOf = (s: Stream) => Number(s.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? s.tags?.rotate ?? 0);
/** Onde estÃ¡ o vermelho: os quatro cantos (cima esq., cima dir., baixo esq., baixo dir.) de um frame a meio. */
function corners(file: string, seek = true): string {
  const raw = execFileSync(FF, ['-v', 'error', ...(seek ? ['-ss', '1'] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=4:4:flags=area,format=rgb24', '-f', 'rawvideo', '-']);
  return [0, 3, 12, 15].map((k) => (raw[k * 3] > 128 && raw[k * 3 + 2] < 128 ? 'R' : '.')).join('');
}

describe('vÃ­deos gravados ao alto com rotaÃ§Ã£o nos metadados (mimos deitados)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token = '';
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'r'.repeat(40), NODE_ENV: 'test', MEDIA_DIR, IMAGE_MODERATION: 'off' }));
    await app.init();
    const username = `rot${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Rot', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    token = r.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function convert(bytes: Buffer, mime: string) {
    const up = await api().post('/api/v1/media/uploads').set(auth()).send({ mime, size: bytes.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
    const id = up.body.assetId as string;
    await api().post(`/api/v1/media/${id}/complete`).set(auth()).expect(200);
    for (let i = 0; i < 60; i++) {
      const s = (await api().get(`/api/v1/media/${id}/status`).set(auth()).expect(200)).body as { status: string; error?: string };
      if (s.status === 'ready') return id;
      if (s.status === 'deleted') throw new Error(`recusado: ${s.error}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('conversÃ£o demorou demais');
  }

  // O que um leitor que respeita a rotaÃ§Ã£o mostra (o vermelho do canto de cima Ã  esquerda, depois de rodar).
  const cases: { name: keyof typeof MATRIX; ext: 'mp4' | 'mov'; mime: string; w: number; h: number; red: string }[] = [
    { name: 'cw90', ext: 'mp4', mime: 'video/mp4', w: 180, h: 320, red: '.R..' },
    { name: 'cw90', ext: 'mov', mime: 'video/quicktime', w: 180, h: 320, red: '.R..' },
    { name: 'ccw90', ext: 'mp4', mime: 'video/mp4', w: 180, h: 320, red: '..R.' },
    { name: 'r180', ext: 'mov', mime: 'video/quicktime', w: 320, h: 180, red: '...R' },
    { name: 'transpose', ext: 'mp4', mime: 'video/mp4', w: 180, h: 320, red: 'R...' },
  ];

  it.each(cases)('$name ($ext): sai com os pÃ­xeis ao alto, sem rotaÃ§Ã£o, e o tamanho guardado Ã© o de mostrar', async ({ name, ext, mime, w, h, red }) => {
    const src = rotatedVideo(name, ext);
    // a fonte Ã© mesmo deitada nos frames, com a rotaÃ§Ã£o nos metadados
    const dir = mkdtempSync(join(tmpdir(), 'txill-rot-src-'));
    const srcFile = join(dir, `src.${ext}`);
    writeFileSync(srcFile, src);
    const s = videoStream(srcFile);
    expect([s.width, s.height]).toEqual([320, 180]);
    expect(rotationOf(s)).not.toBe(0);

    const id = await convert(src, mime);
    const out = join(MEDIA_DIR, id);
    const v = videoStream(out);
    expect([v.width, v.height]).toEqual([w, h]);
    expect(rotationOf(v)).toBe(0); // nenhum leitor (Android antigo, Safari) volta a rodar
    expect(corners(out)).toBe(red);

    const poster = videoStream(join(MEDIA_DIR, `${id}.poster.jpg`));
    expect([poster.width, poster.height]).toEqual([w, h]);
    expect(corners(join(MEDIA_DIR, `${id}.poster.jpg`), false)).toBe(red);

    const { rows } = await pool.query('SELECT width, height FROM content.media_assets WHERE id = $1', [id]);
    expect([rows[0].width, rows[0].height]).toEqual([w, h]);
  }, 60_000);

  it('a assinatura de um vÃ­deo com rotaÃ§Ã£o usa o tamanho de mostrar (nÃ£o o dos frames guardados)', async () => {
    const out = await signVideo(rotatedVideo('cw90', 'mp4'), `rot${run}`);
    const dir = mkdtempSync(join(tmpdir(), 'txill-rot-sign-'));
    const file = join(dir, 'signed.mp4');
    writeFileSync(file, out);
    const v = videoStream(file);
    expect([v.width, v.height]).toEqual([180, 320]);
    expect(rotationOf(v)).toBe(0);
    expect(corners(file)).toBe('.R..');
    // A assinatura (branca) fica no canto de baixo à direita do vídeo ao alto; com o tamanho dos frames guardados (320×180)
    // ficava desenhada fora do vídeo.
    const raw = execFileSync(FF, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'crop=iw/2:ih/2:iw/2:ih/2,format=rgb24', '-f', 'rawvideo', '-']);
    let white = 0;
    for (let i = 0; i < raw.length; i += 3) if (raw[i] > 200 && raw[i + 1] > 200 && raw[i + 2] > 200) white += 1;
    expect(white).toBeGreaterThan(20);
  }, 60_000);
});
