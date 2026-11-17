import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { withCode } from './i18n.filter';

/** Os erros sem frase própria levam um `code` (a app reconhece-os sem ler o texto, que muda de idioma). */
describe('withCode', () => {
  const of = (e: { getResponse(): string | object; name: string; getStatus(): number }) => withCode(e.getResponse(), e) as Record<string, unknown>;

  it('os do Nest por omissão: generic', () => {
    expect(of(new ForbiddenException()).code).toBe('generic');
    expect(of(new NotFoundException()).code).toBe('generic');
  });
  it('o limite de pedidos: too_many_requests', () => {
    expect(of(new ThrottlerException()).code).toBe('too_many_requests');
  });
  it('uma frase nossa fica sem code; um code que já vem fica', () => {
    expect(of(new ForbiddenException('O @rui não aceita pedidos públicos')).code).toBeUndefined();
    expect(of(new BadRequestException({ code: 'invalid_input', message: 'Dados inválidos' })).code).toBe('invalid_input');
  });
});
