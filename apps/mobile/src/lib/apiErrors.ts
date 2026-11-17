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
