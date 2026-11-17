import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { pickLang, SOURCE_LANG, storedLang, type Lang } from './i18n';

/** O idioma do pedido em curso (do Accept-Language), disponível em qualquer sítio do código que o pedido corre. */
const als = new AsyncLocalStorage<{ lang: Lang }>();

/** Middleware: lê o Accept-Language (só os códigos da lista; senão pt) e guarda-o para o resto do pedido. */
export function requestLangMiddleware(req: Request, _res: Response, next: NextFunction) {
  const lang = pickLang(req.headers['accept-language']);
  (req as Request & { lang?: Lang }).lang = lang;
  als.run({ lang }, () => next());
}

/** O idioma do pedido em curso (pt fora de um pedido: tarefas agendadas, workers). */
export const requestLang = (): Lang => als.getStore()?.lang ?? SOURCE_LANG;

/** Corre `fn` como se o pedido fosse em `lang` (testes e tarefas). */
export const withLang = <T>(lang: Lang, fn: () => T): T => als.run({ lang }, fn);

/**
 * O idioma de quem recebe um push, uma notificação ou um e-mail: o que escolheu na conta; sem escolha, português.
 * Para um e-mail que a própria pessoa pediu agora (confirmar o e-mail, recuperar a senha), `self` usa o idioma do pedido.
 */
export const recipientLang = (stored: unknown, self = false): Lang => storedLang(stored) ?? (self ? requestLang() : SOURCE_LANG);
