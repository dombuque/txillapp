// Teste de justiça e de tempo da verificação de fotos, com os modelos reais (fora do Jest, que isola o Float32Array do
// onnxruntime). Corre o classificador e o detetor em todas as fotos de uma pasta (com subpastas = categorias) e compara
// o sistema antigo (v1.40.0: classificador ≥ 0.85 recusa, ≥ 0.5 moderação) com o novo (decide()).
//   npx ts-node scripts/bench-nudez.ts C:/dombuque/tmp-nudez/imgs [640m|320n] > resultados.tsv
// As fotos não vão para o git. Nunca usar fotos com nudez real.
import { readFileSync, readdirSync, statSync } from 'fs';
import { extname, join, relative } from 'path';
import { loadConfig } from '../src/config';
import { LocalNsfwClassifier, decide, type DecisionRules } from '../src/moderation/image-moderation.service';
import { NudeNetDetector, type Detection } from '../src/moderation/nudenet';

const mimeOf = (f: string) => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } as Record<string, string>)[extname(f).toLowerCase()];
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : mimeOf(f) ? [join(d, f)] : []));
const old = (s: number) => (s >= 0.85 ? 'reject' : s >= 0.5 ? 'review' : 'ok');

(async () => {
  const dir = process.argv[2];
  const model = (process.argv[3] ?? '640m') as '640m' | '320n';
  const cfg = loadConfig({ DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'b'.repeat(40) });
  const rules: DecisionRules = { autoReject: true, rejectConfidence: cfg.NUDE_REJECT_CONFIDENCE, reviewConfidence: cfg.NUDE_REVIEW_CONFIDENCE, rejectMinScore: cfg.NUDE_REJECT_MIN_NSFW, reviewScore: cfg.NSFW_REVIEW_THRESHOLD };
  const cacheDir = process.env.MODEL_CACHE_DIR ?? './.models';
  const cls = new LocalNsfwClassifier(cacheDir, cfg.NSFW_MODEL);
  const det = new NudeNetDetector(cacheDir, model);
  await cls.load();
  await det.warmUp();
  const files = walk(dir);
  const tally = new Map<string, Record<string, number>>();
  const add = (k: string, v: string) => {
    const t = tally.get(k) ?? { n: 0 };
    t.n++;
    t[v] = (t[v] ?? 0) + 1;
    tally.set(k, t);
  };
  const tCls: number[] = [];
  const tDet: number[] = [];
  console.log(['file', 'cat', 'nsfw', 'old', 'new_gated', 'new_always', 'reason', 'top_detections', 'ms_cls', 'ms_det', 'detections'].join('\t'));
  for (const f of files) {
    const bytes = readFileSync(f);
    const cat = relative(dir, f).split(/[\\/]/)[0];
    const t0 = Date.now();
    const score = await cls.nsfwScore(bytes, mimeOf(f));
    const t1 = Date.now();
    // O detetor corre sempre aqui (para medir), mas a decisão «gated» só o usa com o classificador ≥ NSFW_DETECT_THRESHOLD.
    const dets: Detection[] = await det.detect(bytes);
    const t2 = Date.now();
    tCls.push(t1 - t0);
    tDet.push(t2 - t1);
    const gated = decide(score, score >= cfg.NSFW_DETECT_THRESHOLD ? dets : null, rules);
    const always = decide(score, dets, rules);
    const top = dets.filter((d) => /EXPOSED/.test(d.label)).slice(0, 3).map((d) => `${d.label}:${d.score.toFixed(2)}`).join(',');
    add('old', old(score));
    add('new', gated.verdict);
    add('new_always', always.verdict);
    add(`old/${cat}`, old(score));
    add(`new/${cat}`, gated.verdict);
    console.log([relative(dir, f), cat, score.toFixed(3), old(score), gated.verdict, always.verdict, gated.reason ?? '', top, t1 - t0, t2 - t1, JSON.stringify(dets.map((d) => [d.label, +d.score.toFixed(3)]))].join('\t'));
  }
  const p = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
  console.error(`\n${files.length} fotos · modelo ${model}`);
  for (const [k, v] of [...tally.entries()].sort()) console.error(`${k.padEnd(22)} n=${v.n}  ok=${v.ok ?? 0}  moderação=${v.review ?? 0}  recusa=${v.reject ?? 0}`);
  console.error(`classificador: mediana ${p(tCls, 0.5)} ms, p95 ${p(tCls, 0.95)} ms · detetor ${model}: mediana ${p(tDet, 0.5)} ms, p95 ${p(tDet, 0.95)} ms`);
})().catch((e) => {
  console.error('ERRO:', e);
  process.exit(1);
});
