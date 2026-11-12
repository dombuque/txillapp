import { posterMsOf } from './media.controller';
import { posterSeek } from './video.service';

// A capa escolhida no estúdio de tchekas: o cliente manda `posterMs` no /media/:id/complete e o ffmpeg tira a capa aí.
describe('posterSeek', () => {
  it('sem escolha: aos 0,5 s, ou a meio nos vídeos curtos (como sempre)', () => {
    expect(posterSeek(10)).toBe(0.5);
    expect(posterSeek(0.6)).toBe(0.3);
    expect(posterSeek(10, null)).toBe(0.5);
  });
  it('com escolha: no instante pedido, sem sair do vídeo', () => {
    expect(posterSeek(10, 4200)).toBe(4.2);
    expect(posterSeek(10, 0)).toBe(0);
    expect(posterSeek(10, 60_000)).toBe(9.9);
    expect(posterSeek(10, Number.NaN)).toBe(0.5);
  });
});

describe('posterMsOf', () => {
  it('só números entre 0 e 60 000', () => {
    expect(posterMsOf(1500)).toBe(1500);
    expect(posterMsOf('2300.4')).toBe(2300);
    expect(posterMsOf(undefined)).toBeUndefined();
    expect(posterMsOf(-1)).toBeUndefined();
    expect(posterMsOf(70_000)).toBeUndefined();
    expect(posterMsOf('abc')).toBeUndefined();
    expect(posterMsOf({})).toBeUndefined();
  });
});
