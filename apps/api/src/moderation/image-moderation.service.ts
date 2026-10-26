import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';

/** Devolve a probabilidade (0 a 1) de a imagem ter nudez ou conteúdo sexual. */
export interface ImageClassifier {
  nsfwScore(image: Buffer, mime: string): Promise<number>;
}
export const IMAGE_CLASSIFIER = Symbol('IMAGE_CLASSIFIER');

export type ImageVerdict = { verdict: 'ok' | 'review' | 'reject'; score: number | null };

/**
 * Classificador local (nada sai do servidor): ViT treinado para separar "sfw" de "nsfw",
 * a correr em ONNX no próprio processo. O modelo é descarregado uma vez para MODEL_CACHE_DIR.
 */
export class LocalNsfwClassifier implements ImageClassifier {
  private pipe: Promise<(input: Blob, opts: { top_k: number }) => Promise<{ label: string; score: number }[]>> | null = null;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly cacheDir: string, private readonly model: string) {}

  private load() {
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

  /** No máximo 2 análises ao mesmo tempo: o resto espera (não sobrecarrega o servidor). */
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

  async nsfwScore(image: Buffer, mime: string): Promise<number> {
    const pipe = await this.load();
    const out = await this.slot(() => pipe(new Blob([new Uint8Array(image)], { type: mime }), { top_k: 2 }));
    return out.find((o) => o.label.toLowerCase() === 'nsfw')?.score ?? 0;
  }
}

/**
 * Verifica as fotos antes de ficarem visíveis:
 *  • pontuação ≥ REJECT → a foto é recusada (nudez ou conteúdo sexual);
 *  • entre REVIEW e REJECT → passa, mas vai para a fila da moderação;
 *  • abaixo → passa.
 * Se o classificador falhar, a foto é recusada com um pedido para tentar de novo (falha fechada),
 * porque o objetivo é nada impróprio chegar a ninguém.
 */
@Injectable()
export class ImageModerationService {
  private readonly log = new Logger('ImageModeration');
  private readonly classifier: ImageClassifier | null;
  readonly enabled: boolean;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(IMAGE_CLASSIFIER) override?: ImageClassifier | null,
  ) {
    this.classifier = override ?? (config.IMAGE_MODERATION === 'local' ? new LocalNsfwClassifier(config.MODEL_CACHE_DIR, config.NSFW_MODEL) : null);
    this.enabled = !!this.classifier;
    if (!this.enabled && config.NODE_ENV === 'production') this.log.warn('Verificação automática de fotos DESLIGADA (IMAGE_MODERATION=off). Não recomendado em produção.');
  }

  async check(image: Buffer, mime: string): Promise<ImageVerdict> {
    if (!this.classifier) return { verdict: 'ok', score: null };
    let score: number;
    try {
      score = await this.classifier.nsfwScore(image, mime);
    } catch (e) {
      this.log.error(`falha ao analisar a foto: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Não consegui verificar a foto agora. Tenta daqui a pouco.');
    }
    if (score >= this.config.NSFW_REJECT_THRESHOLD) return { verdict: 'reject', score };
    if (score >= this.config.NSFW_REVIEW_THRESHOLD) return { verdict: 'review', score };
    return { verdict: 'ok', score };
  }
}
