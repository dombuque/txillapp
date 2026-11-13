import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig, CONFIG } from '../config';

export type HumanResult = 'off' | 'passed' | 'failed' | 'missing' | 'unavailable';

/**
 * Cloudflare Turnstile: a prova de humano invisível. A app (no browser, um widget invisível; na app nativa, o mesmo widget
 * numa WebView escondida) recebe um código de uso único e manda-o no cabeçalho `X-Turnstile-Token`. Aqui confirmamos o
 * código com a Cloudflare (siteverify) usando a chave secreta. Não mandamos o IP nem nada da pessoa: só o código.
 *
 * Se a Cloudflare não responder (falha de rede, mais de 4 s), o pedido passa e fica registado como 'unavailable': um
 * problema do lado deles não pode impedir as pessoas de entrar.
 */
@Injectable()
export class TurnstileService {
  private readonly log = new Logger('Turnstile');

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  get enabled() {
    return !!this.config.TURNSTILE_SECRET;
  }

  /** A chave pública do site (TURNSTILE_SITEKEY), para a app que não a trouxe da compilação. */
  get siteKey(): string | null {
    return this.config.TURNSTILE_SITEKEY ?? null;
  }

  /** O código que veio no pedido (cabeçalho), se tem um tamanho razoável. */
  static tokenOf(req: Pick<Request, 'headers'>): string | undefined {
    const t = req.headers['x-turnstile-token'];
    return typeof t === 'string' && t.length >= 10 && t.length <= 2048 ? t : undefined;
  }

  /** É a app nativa? (lá a prova pode faltar nas versões antigas, conforme TURNSTILE_NATIVE) */
  static isNative(req: Pick<Request, 'headers'>) {
    return req.headers['x-client'] === 'txillapp-mobile';
  }

  /** A prova é obrigatória para este pedido? (só quando está ligada; na app nativa, conforme TURNSTILE_NATIVE) */
  required(req: Pick<Request, 'headers'>) {
    if (!this.enabled) return false;
    return !TurnstileService.isNative(req) || this.config.TURNSTILE_NATIVE === 'required';
  }

  async verify(token: string | undefined): Promise<HumanResult> {
    if (!this.enabled) return 'off';
    if (!token) return 'missing';
    try {
      const body = new URLSearchParams({ secret: this.config.TURNSTILE_SECRET!, response: token });
      const res = await fetch(this.config.TURNSTILE_VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
      if (r.success === true) return 'passed';
      // Chave secreta errada do nosso lado: é falha nossa, não da pessoa.
      if (r['error-codes']?.some((c) => c === 'invalid-input-secret' || c === 'missing-input-secret')) {
        this.log.error('TURNSTILE_SECRET inválida: a prova de humano não está a funcionar');
        return 'unavailable';
      }
      return 'failed';
    } catch (e) {
      this.log.warn(`a Cloudflare não respondeu: ${(e as Error).message}`);
      return 'unavailable';
    }
  }
}
