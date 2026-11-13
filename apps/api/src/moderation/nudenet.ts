import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { readFile, rename, rm } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import sharp from 'sharp';

/**
 * Detetor de partes do corpo expostas: NudeNet v3 (notAI-tech/NudeNet, AGPL-3.0), um YOLOv8 treinado com as classes
 * abaixo. Corre em ONNX no próprio servidor (onnxruntime-node, o mesmo que o @huggingface/transformers já traz); nada sai
 * daqui. Os pesos são descarregados uma vez, sem alterações, da página de lançamentos oficial para MODEL_CACHE_DIR e
 * conferidos pelo SHA-256.
 *
 * O pré e o pós-processamento seguem o nudenet.py oficial (v3.4): a imagem é posta num quadrado com preto à direita e em
 * baixo (o canto de cima à esquerda fica no sítio), reduzida para N×N, RGB a 0..1; à saída, cada uma das N âncoras traz
 * cx, cy, w, h e as 18 pontuações; fica a classe mais alta se ≥ 0.2, e o NMS (sem olhar à classe, como o
 * cv2.dnn.NMSBoxes) com pontuação ≥ 0.25 e IoU 0.45.
 */
export const NUDENET_LABELS = [
  'FEMALE_GENITALIA_COVERED',
  'FACE_FEMALE',
  'BUTTOCKS_EXPOSED',
  'FEMALE_BREAST_EXPOSED',
  'FEMALE_GENITALIA_EXPOSED',
  'MALE_BREAST_EXPOSED',
  'ANUS_EXPOSED',
  'FEET_EXPOSED',
  'BELLY_COVERED',
  'FEET_COVERED',
  'ARMPITS_COVERED',
  'ARMPITS_EXPOSED',
  'FACE_MALE',
  'BELLY_EXPOSED',
  'MALE_GENITALIA_EXPOSED',
  'ANUS_COVERED',
  'FEMALE_BREAST_COVERED',
  'BUTTOCKS_COVERED',
] as const;
export type NudeLabel = (typeof NUDENET_LABELS)[number];

/** Uma parte do corpo encontrada: a classe, a confiança (0 a 1) e a caixa [x, y, largura, altura] em píxeis da imagem. */
export interface Detection { label: NudeLabel; score: number; box: [number, number, number, number] }

/** Os modelos publicados (v3.4-weights). `size`: a resolução de treino. */
export const NUDENET_MODELS = {
  '320n': {
    size: 320,
    file: 'nudenet-v3.4-320n.onnx',
    sha256: 'c15d8273adad2d0a92f014cc69ab2d6c311a06777a55545f2c4eb46f51911f0f',
    urls: [
      'https://api.github.com/repos/notAI-tech/NudeNet/releases/assets/176831997',
      'https://github.com/notAI-tech/NudeNet/releases/download/v3.4-weights/320n.onnx',
    ],
  },
  '640m': {
    size: 640,
    file: 'nudenet-v3.4-640m.onnx',
    sha256: '04fe3d77980780c1f8297dc6d7f942fd5b3abe6942a188f742a85241e4f634eb',
    urls: [
      'https://api.github.com/repos/notAI-tech/NudeNet/releases/assets/176832019',
      'https://github.com/notAI-tech/NudeNet/releases/download/v3.4-weights/640m.onnx',
    ],
  },
} as const;
export type NudeNetModel = keyof typeof NUDENET_MODELS;

/** Quadrado de lado N com a imagem reduzida no canto de cima à esquerda (o resto a preto), como o NudeNet oficial. */
export function letterbox(width: number, height: number, size: number) {
  const scale = size / Math.max(width, height);
  const w = Math.max(1, Math.min(size, Math.round(width * scale)));
  const h = Math.max(1, Math.min(size, Math.round(height * scale)));
  return { scale, width: w, height: h, padRight: size - w, padBottom: size - h };
}

export function iou(a: Detection['box'], b: Detection['box']): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** NMS sem olhar à classe (como o cv2.dnn.NMSBoxes do NudeNet): da mais confiante para a menos, tira as que se sobrepõem. */
export function nms(dets: Detection[], scoreThreshold = 0.25, iouThreshold = 0.45): Detection[] {
  const sorted = dets.filter((d) => d.score >= scoreThreshold).sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of sorted) if (kept.every((k) => iou(k.box, d.box) <= iouThreshold)) kept.push(d);
  return kept;
}

/**
 * A saída do YOLOv8 ([1, 4 + classes, âncoras], com as âncoras seguidas em cada linha) em caixas na imagem original.
 * `scale`: a redução usada no letterbox (as coordenadas do modelo dividem-se por ela).
 */
export function decodeYolo(out: Float32Array | number[], anchors: number, scale: number, width: number, height: number, minScore = 0.2): Detection[] {
  const classes = NUDENET_LABELS.length;
  const dets: Detection[] = [];
  for (let i = 0; i < anchors; i++) {
    let best = -1;
    let score = -Infinity;
    for (let c = 0; c < classes; c++) {
      const s = out[(4 + c) * anchors + i];
      if (s > score) {
        score = s;
        best = c;
      }
    }
    if (score < minScore) continue;
    const cx = out[i], cy = out[anchors + i], bw = out[2 * anchors + i], bh = out[3 * anchors + i];
    const x = Math.max(0, Math.min((cx - bw / 2) / scale, width));
    const y = Math.max(0, Math.min((cy - bh / 2) / scale, height));
    const w = Math.min(bw / scale, width - x);
    const h = Math.min(bh / scale, height - y);
    dets.push({ label: NUDENET_LABELS[best], score, box: [x, y, w, h] });
  }
  return dets;
}

/** A imagem pronta para o modelo: [1, 3, N, N] em RGB de 0 a 1 (primeiro só o R, depois o G, depois o B). */
export async function preprocess(image: Buffer, size: number) {
  // A foto como se vê (rotação do EXIF), só a primeira imagem de uma animação.
  const meta = await sharp(image, { failOn: 'none', animated: false }).metadata();
  if (!meta.width || !meta.height) throw new Error('imagem sem dimensões');
  const turned = (meta.orientation ?? 1) >= 5; // 90° ou 270°: a largura e a altura trocam
  const probe = { width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height };
  const lb = letterbox(probe.width, probe.height, size);
  // O sharp roda antes de reduzir e acrescenta o preto depois: o mesmo que pôr no quadrado e reduzir.
  const { data, info } = await sharp(image, { failOn: 'none', animated: false })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb') // fotos a preto e branco: três canais na mesma
    .resize(lb.width, lb.height, { fit: 'fill', kernel: 'linear' })
    .extend({ right: lb.padRight, bottom: lb.padBottom, background: { r: 0, g: 0, b: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || info.width !== size || info.height !== size) throw new Error(`imagem inesperada (${info.width}×${info.height}×${info.channels})`);
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    tensor[p] = data[p * 3] / 255;
    tensor[plane + p] = data[p * 3 + 1] / 255;
    tensor[2 * plane + p] = data[p * 3 + 2] / 255;
  }
  return { tensor, scale: lb.scale, width: probe.width, height: probe.height };
}

/** Descarrega o modelo para a pasta, se ainda lá não estiver, e confere o SHA-256. Devolve o caminho. */
export async function ensureModel(cacheDir: string, model: NudeNetModel, fetchImpl: typeof fetch = fetch): Promise<string> {
  const m = NUDENET_MODELS[model];
  const dir = join(cacheDir, 'nudenet');
  const file = join(dir, m.file);
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.part`;
  let last: Error | null = null;
  for (const url of m.urls) {
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/octet-stream', 'User-Agent': 'txillapp-api' }, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(tmp));
      const sum = createHash('sha256').update(await readFile(tmp)).digest('hex');
      if (sum !== m.sha256) throw new Error(`SHA-256 diferente (${sum.slice(0, 12)}…)`);
      await rename(tmp, file);
      return file;
    } catch (e) {
      last = new Error(`${url}: ${(e as Error).message}`);
      await rm(tmp, { force: true });
    }
  }
  throw new Error(`não consegui descarregar o modelo NudeNet ${model}: ${last?.message}`);
}

type OrtSession = { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: readonly number[] }>> };

/** O NudeNet a correr no onnxruntime-node. Carrega (e descarrega, na 1.ª vez) o modelo no primeiro pedido ou em `warmUp()`. */
export class NudeNetDetector {
  private session: Promise<{ s: OrtSession; Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown }> | null = null;

  constructor(private readonly cacheDir: string, readonly model: NudeNetModel = '640m', private readonly threads = 3) {}

  private load() {
    this.session ??= (async () => {
      const path = await ensureModel(this.cacheDir, this.model);
      const ort = await import('onnxruntime-node');
      const s = await ort.InferenceSession.create(path, { intraOpNumThreads: this.threads, interOpNumThreads: 1, graphOptimizationLevel: 'all' });
      return { s: s as unknown as OrtSession, Tensor: ort.Tensor as unknown as new (type: 'float32', data: Float32Array, dims: number[]) => unknown };
    })().catch((e) => {
      this.session = null; // volta a tentar no próximo pedido
      throw e;
    });
    return this.session;
  }

  warmUp() {
    return this.load().then(() => undefined);
  }

  async detect(image: Buffer): Promise<Detection[]> {
    const { s, Tensor } = await this.load();
    const size = NUDENET_MODELS[this.model].size;
    const pre = await preprocess(image, size);
    const out = await s.run({ [s.inputNames[0]]: new Tensor('float32', pre.tensor, [1, 3, size, size]) });
    const o = out[s.outputNames[0]];
    return nms(decodeYolo(o.data as Float32Array, o.dims[2], pre.scale, pre.width, pre.height));
  }
}
