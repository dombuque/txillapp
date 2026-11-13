import { hostname } from 'os';
import { randomBytes } from 'crypto';
import type { AppConfig } from '../config';

/**
 * O papel deste processo (docs/escala.md):
 *   ROLE=web     só serve pedidos: sem tarefas periódicas e sem filas (montagem das tchekas, vídeos);
 *   ROLE=worker  corre as tarefas periódicas e as filas (e responde a /health e /metrics, sem tráfego do nginx);
 *   sem ROLE     faz tudo, como uma instância só (desenvolvimento e testes).
 */
export function runsBackground(config: Pick<AppConfig, 'ROLE'>): boolean {
  return config.ROLE !== 'web';
}

/**
 * Um nome único para cada instância da app (o contentor, o pid e um sufixo ao acaso): quem pegou num trabalho da fila,
 * de onde veio um evento do Redis. Cada app tem o seu (nos testes há duas no mesmo processo).
 */
export function newInstanceId(): string {
  return `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
}
