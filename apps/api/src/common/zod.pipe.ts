import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z, ZodSchema } from 'zod';
import type { Lang } from '../i18n/i18n';
import { requestLang } from '../i18n/request-lang';

/** As mensagens próprias do zod (as que o código não escreve) no idioma do pedido; as do código traduz o filtro. */
const zodLocales = new Map<Lang, z.core.$ZodErrorMap>();
function zodErrors(lang: Lang): z.core.$ZodErrorMap | undefined {
  if (!zodLocales.has(lang)) {
    const make = (z.locales as unknown as Record<string, (() => { localeError: z.core.$ZodErrorMap }) | undefined>)[lang];
    if (make) zodLocales.set(lang, make().localeError);
  }
  return zodLocales.get(lang);
}

export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const error = zodErrors(requestLang());
    const result = this.schema.safeParse(value, error ? { error } : undefined);
    if (!result.success) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: 'Dados inválidos',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
