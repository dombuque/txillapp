import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { pickLang, SOURCE_LANG, translateText, type Lang } from './i18n';

/**
 * As mensagens de erro para a pessoa no idioma do pedido (Accept-Language). Os textos estão em português no código (são
 * a chave do catálogo); aqui traduz-se o `message` (texto ou lista), os `issues[].message` das validações e o `hint`.
 * O `code` e o resto da resposta ficam iguais. O resto (erros que não são HttpException) segue o filtro do Nest.
 */
@Catch()
export class I18nExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (!(exception instanceof HttpException) || host.getType() !== 'http') return super.catch(exception, host);
    const req = host.switchToHttp().getRequest<Request & { lang?: Lang }>();
    const lang = req?.lang ?? pickLang(req?.headers?.['accept-language']);
    if (lang === SOURCE_LANG) return super.catch(exception, host);
    const body = translateBody(exception.getResponse(), exception.getStatus(), lang);
    const translated = new HttpException(body, exception.getStatus(), { cause: exception });
    return super.catch(translated, host);
  }
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
