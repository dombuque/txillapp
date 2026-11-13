import { Inject, Injectable, Logger, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import client from 'prom-client';
import { AppConfig, CONFIG } from '../config';
import { registry } from '../observability/metrics';
import { NudeNetDetector, type Detection, type NudeLabel } from './nudenet';

/** Devolve a probabilidade (0 a 1) de a imagem ter nudez ou conteúdo sexual. */
export interface ImageClassifier {
  nsfwScore(image: Buffer, mime: string): Promise<number>;
}
export const IMAGE_CLASSIFIER = Symbol('IMAGE_CLASSIFIER');

/** Encontra partes do corpo (expostas ou tapadas) numa imagem. */
export interface BodyPartDetector {
  detect(image: Buffer, mime: string): Promise<Detection[]>;
}
export const BODY_DETECTOR = Symbol('BODY_DETECTOR');

/**
 * `score`: a pontuação do classificador (null se a verificação está desligada). `reason`: o motivo, para o relatório da
 * moderação («Detetado: mamilos femininos expostos (78%)»). `ms`: quanto demorou a análise.
 */
export type ImageVerdict = { verdict: 'ok' | 'review' | 'reject'; score: number | null; reason: string | null; detections?: Detection[]; ms?: number };

/** Partes que, expostas e com confiança alta, levam à recusa. */
export const REJECT_PARTS: readonly NudeLabel[] = ['FEMALE_GENITALIA_EXPOSED', 'MALE_GENITALIA_EXPOSED', 'ANUS_EXPOSED', 'FEMALE_BREAST_EXPOSED'];
/** Partes que, expostas, só mandam a foto para a moderação (nunca recusam sozinhas). */
export const REVIEW_PARTS: readonly NudeLabel[] = ['BUTTOCKS_EXPOSED'];

export const PART_NAMES: Partial<Record<NudeLabel, string>> = {
  FEMALE_GENITALIA_EXPOSED: 'genitais femininos expostos',
  MALE_GENITALIA_EXPOSED: 'genitais masculinos expostos',
  ANUS_EXPOSED: 'ânus exposto',
  FEMALE_BREAST_EXPOSED: 'mamilos femininos expostos',
  BUTTOCKS_EXPOSED: 'nádegas expostas',
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
export const detectedReason = (d: Detection) => `Detetado: ${PART_NAMES[d.label] ?? d.label} (${pct(d.score)})`;

export interface DecisionRules {
  /** Recusar quando o detetor encontra genitais, ânus ou mamilos femininos expostos (NSFW_AUTO_REJECT). */
  autoReject: boolean;
  /** Confiança do detetor a partir da qual se recusa (NUDE_REJECT_CONFIDENCE). */
  rejectConfidence: number;
  /** Confiança do detetor a partir da qual a foto vai para a moderação (NUDE_REVIEW_CONFIDENCE). */
  reviewConfidence: number;
  /** Para recusar, o classificador também tem de dar pelo menos isto (NUDE_REJECT_MIN_NSFW). */
  rejectMinScore: number;
  /** O classificador sozinho, sem o detetor confirmar, manda para a moderação a partir daqui (NSFW_REVIEW_THRESHOLD). */
  reviewScore: number;
}

/**
 * A decisão combinada. `dets`: o que o detetor encontrou; `null` se não correu (classificador abaixo de
 * NSFW_DETECT_THRESHOLD, ou detetor desligado); `'failed'` se falhou.
 *  • recusar: só com prova (o detetor encontrou genitais, ânus ou mamilos femininos expostos com confiança alta);
 *  • moderação (passa e vai para a fila): partes expostas com menos confiança, nádegas expostas, ou o classificador muito
 *    alto sem o detetor confirmar;
 *  • passar: o resto.
 */
export function decide(score: number, dets: Detection[] | null | 'failed', r: DecisionRules): ImageVerdict {
  const classifier = `classificador ${pct(score)}`;
  if (dets === 'failed') {
    // Sem o detetor nunca se recusa: na dúvida passa e vai para a moderação (como na v1.40.1).
    return score >= Math.min(0.5, r.reviewScore) ? { verdict: 'review', score, reason: `${classifier} (detetor indisponível)` } : { verdict: 'ok', score, reason: null };
  }
  const list = dets ?? [];
  const top = (labels: readonly NudeLabel[]) => list.filter((d) => labels.includes(d.label)).sort((a, b) => b.score - a.score)[0];
  const face = (label: NudeLabel) => Math.max(0, ...list.filter((d) => d.label === label).map((d) => d.score));
  let strong = top(REJECT_PARTS);
  // O detetor confunde às vezes o peito de um homem (tronco nu na praia, no ginásio) com mamilos femininos. Com um rosto de
  // homem e nenhum de mulher mais forte, isso sozinho nunca recusa: vai para a moderação se for forte, senão passa.
  if (strong?.label === 'FEMALE_BREAST_EXPOSED' && face('FACE_MALE') > face('FACE_FEMALE')) {
    const other = top(REJECT_PARTS.filter((l) => l !== 'FEMALE_BREAST_EXPOSED'));
    if (!other && strong.score >= r.rejectConfidence) return { verdict: 'review', score, reason: `${detectedReason(strong)}, com rosto masculino · ${classifier}`, detections: list };
    strong = other;
  }
  if (strong && r.autoReject && strong.score >= r.rejectConfidence && score >= r.rejectMinScore) {
    return { verdict: 'reject', score, reason: detectedReason(strong), detections: list };
  }
  if (strong && strong.score >= r.reviewConfidence) return { verdict: 'review', score, reason: `${detectedReason(strong)} · ${classifier}`, detections: list };
  // Nádegas expostas (fio dental na praia, fato de banho cavado) não são proibidas: só com confiança ≥ 0.5 vão para a fila.
  const soft = top(REVIEW_PARTS);
  if (soft && soft.score >= Math.max(r.reviewConfidence, 0.5)) return { verdict: 'review', score, reason: `${detectedReason(soft)} · ${classifier}`, detections: list };
  if (score >= r.reviewScore) return { verdict: 'review', score, reason: `${classifier}, sem partes expostas detetadas`, detections: list };
  return { verdict: 'ok', score, reason: null, ...(dets ? { detections: list } : {}) };
}

/**
 * Classificador local (nada sai do servidor): ViT treinado para separar "sfw" de "nsfw",
 * a correr em ONNX no próprio processo. O modelo é descarregado uma vez para MODEL_CACHE_DIR.
 */
export class LocalNsfwClassifier implements ImageClassifier {
  private pipe: Promise<(input: Blob, opts: { top_k: number }) => Promise<{ label: string; score: number }[]>> | null = null;

  constructor(private readonly cacheDir: string, private readonly model: string) {}

  load() {
    this.pipe ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = this.cacheDir;
      const p = await pipeline('image-classification', this.model, { dtype: 'q8' });
      return p as unknown as (input: Blob, opts: { top_k: number }) => Promise<{ label: string; score: number }[]>;
    })().catch((e) => {
      this.pipe = null; // volta a tentar no próximo pedido
      throw e;
    });
    return this.pipe;
  }

  async nsfwScore(image: Buffer, mime: string): Promise<number> {
    const pipe = await this.load();
    const out = await pipe(new Blob([new Uint8Array(image)], { type: mime }), { top_k: 2 });
    return out.find((o) => o.label.toLowerCase() === 'nsfw')?.score ?? 0;
  }
}

/** O NudeNet (nudenet.ts) com a interface do serviço. */
export class LocalBodyPartDetector implements BodyPartDetector {
  private readonly net: NudeNetDetector;
  constructor(cacheDir: string, model: '320n' | '640m') {
    this.net = new NudeNetDetector(cacheDir, model);
  }
  warmUp() {
    return this.net.warmUp();
  }
  detect(image: Buffer): Promise<Detection[]> {
    return this.net.detect(image);
  }
}

const seconds = new client.Histogram({
  name: 'image_moderation_seconds',
  help: 'Tempo da verificação automática de uma foto, por etapa (classificador; detetor, quando corre)',
  labelNames: ['stage'] as const,
  buckets: [0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3, 6],
  registers: [registry],
});
const verdicts = new client.Counter({
  name: 'image_moderation_verdicts_total',
  help: 'Veredictos da verificação automática de fotos',
  labelNames: ['verdict'] as const,
  registers: [registry],
});

/**
 * Verifica as fotos antes de ficarem visíveis, com dois modelos locais (nada sai do servidor):
 *  • o classificador (imagem inteira) dá uma pontuação; abaixo de NSFW_DETECT_THRESHOLD a foto passa logo;
 *  • a partir daí corre o detetor de partes do corpo (NudeNet), e a decisão é a de `decide()`.
 * O classificador sozinho nunca recusa: erra em selfies, roupa justa e peles escuras.
 * Se o classificador falhar, a foto é recusada com um pedido para tentar de novo (falha fechada). Se só o detetor falhar,
 * decide o classificador, sem recusar.
 * No máximo 2 análises ao mesmo tempo (classificador e detetor de uma foto contam como uma): o resto espera.
 */
@Injectable()
export class ImageModerationService implements OnModuleInit {
  private readonly log = new Logger('ImageModeration');
  private readonly classifier: ImageClassifier | null;
  private readonly detector: BodyPartDetector | null;
  readonly enabled: boolean;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(IMAGE_CLASSIFIER) override?: ImageClassifier | null,
    @Optional() @Inject(BODY_DETECTOR) detectorOverride?: BodyPartDetector | null,
  ) {
    const local = config.IMAGE_MODERATION === 'local';
    this.classifier = override ?? (local ? new LocalNsfwClassifier(config.MODEL_CACHE_DIR, config.NSFW_MODEL) : null);
    this.detector = detectorOverride ?? (local && config.NUDE_DETECTOR !== 'off' ? new LocalBodyPartDetector(config.MODEL_CACHE_DIR, config.NUDE_DETECTOR) : null);
    this.enabled = !!this.classifier;
    if (!this.enabled && config.NODE_ENV === 'production') this.log.warn('Verificação automática de fotos DESLIGADA (IMAGE_MODERATION=off). Não recomendado em produção.');
    if (this.enabled && !this.detector) this.log.warn('Detetor de partes do corpo desligado (NUDE_DETECTOR=off): nenhuma foto é recusada, as duvidosas vão para a moderação.');
  }

  /** Em produção, os modelos descarregam-se (1.ª vez) e carregam-se logo ao arrancar: a primeira foto não espera. */
  onModuleInit() {
    if (this.config.NODE_ENV !== 'production') return;
    if (this.classifier instanceof LocalNsfwClassifier) void this.classifier.load().catch((e) => this.log.error(`não consegui carregar o classificador: ${(e as Error).message}`));
    if (this.detector instanceof LocalBodyPartDetector) void this.detector.warmUp().catch((e) => this.log.error(`não consegui carregar o detetor: ${(e as Error).message}`));
  }

  get rules(): DecisionRules {
    const c = this.config;
    return { autoReject: c.NSFW_AUTO_REJECT, rejectConfidence: c.NUDE_REJECT_CONFIDENCE, reviewConfidence: c.NUDE_REVIEW_CONFIDENCE, rejectMinScore: c.NUDE_REJECT_MIN_NSFW, reviewScore: c.NSFW_REVIEW_THRESHOLD };
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= 2) await new Promise<void>((r) => this.waiting.push(r));
    this.running += 1;
    try {
      return await fn();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }

  async check(image: Buffer, mime: string): Promise<ImageVerdict> {
    const classifier = this.classifier;
    if (!classifier) return { verdict: 'ok', score: null, reason: null };
    const v = await this.slot(async () => {
      const t0 = Date.now();
      let score: number;
      try {
        score = await classifier.nsfwScore(image, mime);
      } catch (e) {
        this.log.error(`falha ao analisar a foto: ${(e as Error).message}`);
        throw new ServiceUnavailableException('Não consegui verificar a foto agora. Tenta daqui a pouco.');
      }
      const t1 = Date.now();
      seconds.observe({ stage: 'classifier' }, (t1 - t0) / 1000);
      let dets: Detection[] | null | 'failed' = null;
      if (this.detector && score >= this.config.NSFW_DETECT_THRESHOLD) {
        try {
          dets = await this.detector.detect(image, mime);
          seconds.observe({ stage: 'detector' }, (Date.now() - t1) / 1000);
        } catch (e) {
          this.log.error(`falha no detetor de partes do corpo: ${(e as Error).message}`);
          dets = 'failed';
        }
      }
      return { ...decide(score, dets, this.rules), ms: Date.now() - t0 };
    });
    verdicts.inc({ verdict: v.verdict });
    return v;
  }
}
