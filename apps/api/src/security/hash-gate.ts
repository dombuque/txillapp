import { ServiceUnavailableException } from '@nestjs/common';
import { argonInFlight, argonRejected, argonWaiting } from './metrics';

/**
 * Semáforo dos hashes de senha. O argon2 é caro de propósito (19 MB de memória e ~50-100 ms de CPU cada um) e corre na
 * threadpool do Node (4 fios por omissão), a mesma do disco, da compressão e do DNS. Sem isto, mil logins falsos de uma vez
 * enchem a threadpool e o resto da API fica à espera. Com isto:
 *   * no máximo `max` hashes ao mesmo tempo (sobra threadpool para o resto);
 *   * no máximo `queue` à espera; os seguintes recebem logo 503 («tenta daqui a pouco»), sem gastar CPU;
 *   * quem espera mais de `waitMs` também desiste com 503.
 */
export class HashGate {
  private running = 0;
  private readonly waiting: { go: () => void; timer: NodeJS.Timeout }[] = [];

  constructor(readonly max: number, readonly queue: number, readonly waitMs: number) {}

  get stats() {
    return { running: this.running, waiting: this.waiting.length };
  }

  private busy() {
    argonRejected.inc();
    return new ServiceUnavailableException({ code: 'busy', message: 'Estamos com muita gente a entrar ao mesmo tempo. Tenta outra vez daqui a pouco.' });
  }

  private acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      argonInFlight.set(this.running);
      return Promise.resolve();
    }
    if (this.waiting.length >= this.queue) return Promise.reject(this.busy());
    return new Promise<void>((resolve, reject) => {
      const entry = {
        go: () => {
          clearTimeout(entry.timer);
          resolve();
        },
        timer: setTimeout(() => {
          const i = this.waiting.indexOf(entry);
          if (i >= 0) this.waiting.splice(i, 1);
          argonWaiting.set(this.waiting.length);
          reject(this.busy());
        }, this.waitMs),
      };
      this.waiting.push(entry);
      argonWaiting.set(this.waiting.length);
    });
  }

  private release() {
    const next = this.waiting.shift();
    argonWaiting.set(this.waiting.length);
    if (next) next.go(); // a vaga passa diretamente para o seguinte
    else {
      this.running--;
      argonInFlight.set(this.running);
    }
  }

  /** Corre `fn` (um hash ou uma verificação) quando houver vaga. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
