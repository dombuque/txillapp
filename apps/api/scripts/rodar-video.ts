// Endireita um vídeo já publicado que ficou deitado (gravado no site do iPhone com iOS 26 antes da correção da TxCamera:
// os frames vinham deitados e sem rotação no ficheiro, por isso o servidor não tinha como saber). Roda os píxeis, volta a
// tirar a capa e troca a largura e a altura guardadas. Por omissão só mostra o que faria; com --apply escreve.
//   npx ts-node scripts/rodar-video.ts <media_id> <90|180|270> [--apply]
// 90 = rodar no sentido do relógio; 270 = contra. Usa o .env (DATABASE_URL, STORAGE_DRIVER, S3_*, MEDIA_DIR) como a API.
// Os mimos duram 24 horas: isto serve sobretudo para tchekas e publicações. Os browsers podem ter o vídeo antigo em cache.
import 'dotenv/config';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile, rename } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';
import { Pool } from 'pg';
import { loadConfig } from '../src/config';
import { S3Storage } from '../src/media/s3.storage';
import { posterSeek } from '../src/media/video.service';

const run = promisify(execFile);
const FFMPEG = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';
const FILTER: Record<string, string> = { '90': 'transpose=clock', '180': 'hflip,vflip', '270': 'transpose=cclock' };

(async () => {
  const [id, deg] = process.argv.slice(2);
  const apply = process.argv.includes('--apply');
  if (!id || !FILTER[deg ?? '']) throw new Error('Uso: npx ts-node scripts/rodar-video.ts <media_id> <90|180|270> [--apply]');
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const s3 = config.STORAGE_DRIVER === 's3' ? new S3Storage(config) : null;
  const dir = resolve(config.MEDIA_DIR);
  const tmp = await mkdtemp(join(tmpdir(), 'txrodar-'));
  try {
    const { rows } = await pool.query(`SELECT mime, status, purpose, width, height, duration_ms FROM content.media_assets WHERE id = $1`, [id]);
    const a = rows[0];
    if (!a) throw new Error('Não há esse ficheiro.');
    if (a.status !== 'ready' || a.mime !== 'video/mp4') throw new Error(`Não é um vídeo pronto (${a.mime}, ${a.status}).`);
    const scope = a.purpose === 'chat' ? 'private' : 'public';
    const src = join(tmp, 'in.mp4'), out = join(tmp, 'out.mp4'), poster = join(tmp, 'poster.jpg');
    await writeFile(src, s3 ? await s3.read(id, scope) : await readFile(join(dir, id)));
    await run(FFMPEG, ['-y', '-protocol_whitelist', 'file', '-i', src, '-vf', `${FILTER[deg]},format=yuv420p`, '-c:v', 'libx264', '-preset', 'faster', '-crf', '21', '-profile:v', 'high', '-level', '4.1', '-c:a', 'copy', '-movflags', '+faststart', '-map_metadata', '-1', out], { timeout: 5 * 60_000, maxBuffer: 10 * 1024 * 1024 });
    await run(FFMPEG, ['-y', '-protocol_whitelist', 'file', '-ss', String(posterSeek(Number(a.duration_ms) / 1000)), '-i', out, '-frames:v', '1', '-q:v', '4', poster], { timeout: 60_000 });
    const side = deg !== '180';
    const w = side ? a.height : a.width, h = side ? a.width : a.height;
    const bytes = await readFile(out);
    console.log(`${id}: ${a.width}×${a.height} → ${w}×${h} (${deg}°), ${bytes.length} bytes${apply ? '' : ' (só a ver: junta --apply para escrever)'}`);
    if (!apply) return;
    if (s3) {
      await s3.put(id, bytes, 'video/mp4', scope, bytes.length);
      await s3.put(`${id}.poster.jpg`, await readFile(poster), 'image/jpeg', scope);
    } else {
      await writeFile(join(dir, `${id}.tmp`), bytes);
      await rename(join(dir, `${id}.tmp`), join(dir, id));
      await writeFile(join(dir, `${id}.poster.jpg`), await readFile(poster));
    }
    await pool.query('UPDATE content.media_assets SET size_bytes = $2, width = $3, height = $4 WHERE id = $1', [id, bytes.length, w, h]);
    console.log('Feito.');
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await pool.end();
  }
})().catch((e) => {
  console.error('ERRO:', (e as Error).message);
  process.exit(1);
});
