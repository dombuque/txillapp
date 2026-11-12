import { avatarWidth } from './media.controller';

describe('avatarWidth', () => {
  it('256 por omissão e para valores pequenos ou inválidos', () => {
    expect(avatarWidth(undefined)).toBe(256);
    expect(avatarWidth('abc')).toBe(256);
    expect(avatarWidth('100')).toBe(256);
  });
  it('a foto em grande vai até 1080, nunca ao original', () => {
    expect(avatarWidth('720')).toBe(720);
    expect(avatarWidth('1080')).toBe(1080);
    expect(avatarWidth('5000')).toBe(1080);
  });
});
