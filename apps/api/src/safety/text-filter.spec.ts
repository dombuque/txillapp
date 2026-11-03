import { UnprocessableEntityException } from '@nestjs/common';
import { TextFilter, normalize } from './text-filter.service';

const f = new TextFilter();

describe('filtro de texto: ameaças, incentivo ao suicídio e ódio', () => {
  it('normaliza: acentos, números por letras, repetições e pontuação', () => {
    expect(normalize('Vou-te MATÁR!!')).toBe('vou te matar');
    expect(normalize('v0u t3 m4t4r')).toBe('vou te matar');
    expect(normalize('mmmaaatar')).toBe('matar');
    expect(normalize('m.a.t.a.r')).toBe('m a t a r');
  });

  it.each([
    ['Vou-te matar amanhã', 'threat'],
    ['vou matar-te', 'threat'],
    ['v0u t3 m4t4r', 'threat'],
    ['VOU TE ESFAQUEAR', 'threat'],
    ['mato-te se voltas aqui', 'threat'],
    ['v.o.u.t.e.m.a.t.a.r', 'threat'],
    ['I will kill you', 'threat'],
    ["i'm gonna stab you", 'threat'],
    ['mata-te', 'self-harm'],
    ['go kill yourself', 'self-harm'],
    ['kys', 'self-harm'],
    ['preto de merda', 'hate'],
    ['vocês são uns nigger', 'hate'],
    ['matar todos os gays', 'hate'],
    ['bicha nojenta', 'hate'],
  ] as const)('recusa: %s', (text, kind) => {
    expect(f.check(text)).toBe(kind);
    expect(() => f.assertClean(text)).toThrow(UnprocessableEntityException);
  });

  it.each([
    'Vou matar a fome com um bom prato de matapa',
    'Morri de rir com este vídeo',
    'Mata-te a rir com isto',
    'Vou matar o tempo na praia',
    'Este jogo está a matar-me de nervos',
    'A malta toda em paulada hoje! 🍻',
    'Quero beber uma cerveja gelada',
    'Vou te buscar à Polana às 8',
    'I will kill it at the gig tonight',
    'O Teddy é um cão preto e branco muito fixe',
    'Kill the lights, bora dançar',
    'vou te mandar uma mensagem depois',
    '',
  ])('deixa passar: %s', (text) => {
    expect(f.check(text)).toBeNull();
    expect(() => f.assertClean(text)).not.toThrow();
  });

  it('assertClean aceita vários campos e ignora vazios', () => {
    expect(() => f.assertClean('olá', null, undefined, '')).not.toThrow();
    expect(() => f.assertClean('olá', 'vou te matar')).toThrow(/ameaça/);
    expect(() => f.assertClean('kys')).toThrow(/magoar/);
    expect(() => f.assertClean('preto de merda')).toThrow(/ódio/);
  });
});
