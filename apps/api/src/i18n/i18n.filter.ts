import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { pickLang, SOURCE_LANG, translateText, type Lang } from './i18n';

/**
 * As mensagens de erro para a pessoa no idioma do pedido (Accept-Language). Os textos estão em português no código (são
 * a chave do catálogo); aqui traduz-se o `message` (texto ou lista), os `issues[].message` das validações e o `hint`.
 * O `code` e o resto da resposta ficam iguais. O resto (erros que não são HttpException) segue o filtro do Nest.
 *
 * Os erros sem frase própria (os do Nest por omissão, «Forbidden», «Not Found»…, e o limite de pedidos) levam um `code`
 * (`generic`, `too_many_requests`), para a app os reconhecer sem ler o texto, que muda de idioma para idioma.
 */
@Catch()
export class I18nExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (!(exception instanceof HttpException) || host.getType() !== 'http') return super.catch(exception, host);
    const req = host.switchToHttp().getRequest<Request & { lang?: Lang }>();
    const lang = req?.lang ?? pickLang(req?.headers?.['accept-language']);
    const res = exception.getResponse();
    const coded = withCode(res, exception);
    if (lang === SOURCE_LANG && coded === res) return super.catch(exception, host);
    const body = lang === SOURCE_LANG ? coded : translateBody(coded, exception.getStatus(), lang);
    return super.catch(new HttpException(body, exception.getStatus(), { cause: exception }), host);
  }
}

/** As frases do Nest quando a exceção não tem mensagem própria. */
const NEST_DEFAULTS = new Set([
  'Bad Request', 'Unauthorized', 'Payment Required', 'Forbidden', 'Not Found', 'Method Not Allowed', 'Not Acceptable', 'Request Timeout',
  'Conflict', 'Gone', 'Payload Too Large', 'Unsupported Media Type', 'Unprocessable Entity', 'Too Many Requests', 'Internal Server Error',
  'Internal server error', 'Not Implemented', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout',
]);

/** O `code` dos erros sem frase própria; os que já têm `code` (ou uma frase nossa) ficam iguais. */
export function withCode(res: string | object, exception?: { name?: string; getStatus?: () => number }): string | object {
  const status = exception?.getStatus?.();
  const body: Record<string, unknown> = typeof res === 'string' ? { statusCode: status, message: res } : { ...(res as Record<string, unknown>) };
  if (typeof body.code === 'string') return res;
  const msg = typeof body.message === 'string' ? body.message : '';
  if (exception?.name === 'ThrottlerException' || /^ThrottlerException/.test(msg)) return { ...body, code: 'too_many_requests' };
  if ((!msg && !Array.isArray(body.message)) || NEST_DEFAULTS.has(msg)) return { ...body, code: 'generic' };
  return res;
}

const tr = (v: unknown, lang: Lang) => (typeof v === 'string' ? translateText(v, lang) : v);

export function translateBody(res: string | object, status: number, lang: Lang): object {
  if (typeof res === 'string') return { statusCode: status, message: translateText(res, lang) };
  const body = { ...(res as Record<string, unknown>) };
  if (Array.isArray(body.message)) body.message = body.message.map((m) => tr(m, lang));
  else body.message = tr(body.message, lang);
  if ('hint' in body) body.hint = tr(body.hint, lang);
  if (Array.isArray(body.issues)) {
    body.issues = body.issues.map((i) => (i && typeof i === 'object' && 'message' in i ? { ...i, message: tr((i as { message: unknown }).message, lang) } : i));
  }
  return body;
}
