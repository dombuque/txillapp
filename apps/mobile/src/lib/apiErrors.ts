// Os erros da API sem frase própria, reconhecidos pelo `code` (o texto vem no idioma da pessoa). Sem dependências além do
// lib/i18n: os módulos testados no Node (gelada, txillada…) importam daqui e não do lib/api.
import { t } from '@/lib/i18n';

/**
 * `generic` (os erros do Nest por omissão), `invalid_input` (validação), `unexpected` (a resposta não trouxe mensagem):
 * quem mostra o erro troca-os pela frase do ecrã. O limite de pedidos vem com `too_many_requests`.
 */
export const GENERIC_ERROR_CODES: ReadonlySet<string> = new Set(['generic', 'invalid_input', 'unexpected']);
/** A mensagem quando a resposta não traz nenhuma (code `unexpected`). */
export const UNEXPECTED_TEXT = () => t('Erro inesperado');

/**
 * Falha passageira (sem rede, ligação cortada, servidor a reiniciar: 502/503/504, ou resposta sem corpo da API): vale a
 * pena tentar outra vez sozinho. Os 4xx (recusas a sério) não.
 */
export function isTransient(e: unknown): boolean {
  if (!e) return false;
  const status = (e as { status?: unknown }).status;
  if (typeof status === 'number') return status === 0 || status === 408 || status === 502 || status === 503 || status === 504;
  return e instanceof TypeError || /network|failed to fetch|load failed|timed? ?out|aborted|connection/i.test(String((e as Error).message ?? ''));
}

/** Esperas entre as tentativas automáticas (ms): 6 tentativas em cerca de 1 minuto e meio. */
export const AUTO_RETRY_MS: readonly number[] = [2_000, 5_000, 10_000, 15_000, 25_000, 35_000];
