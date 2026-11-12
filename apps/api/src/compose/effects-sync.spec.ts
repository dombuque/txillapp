import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { FONTS } from './effects';

/**
 * Os efeitos da montagem são os do estúdio do site: effects.ts (cor, filtros, ajustes, rampas, transições, camadas, LUT),
 * renderOverlays.ts (o desenho do texto e dos stickers) e renderTransitions.ts são cópias inteiras de
 * apps/mobile/src/lib/studio/ (sem tirar nem pôr), e as fontes de assets/fonts/estudio são os woff2 de
 * apps/mobile/public/fonts/estudio. Quando o mobile está no repositório, têm de ser iguais.
 */
describe('os efeitos da montagem são os do estúdio', () => {
  const studio = join(__dirname, '../../../mobile/src/lib/studio');
  const fonts = join(__dirname, '../../../mobile/public/fonts/estudio');
  const body = (s: string) => s.replace(/\r\n/g, '\n').trim();
  const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

  for (const f of ['effects.ts', 'renderOverlays.ts', 'renderTransitions.ts']) {
    (existsSync(join(studio, f)) ? it : it.skip)(`${f} igual a apps/mobile/src/lib/studio/${f}`, () => {
      expect(body(readFileSync(join(__dirname, f), 'utf8'))).toBe(body(readFileSync(join(studio, f), 'utf8')));
    });
  }

  it('as fontes de todas as famílias do estúdio estão em assets/fonts/estudio', () => {
    const here = join(__dirname, '../../assets/fonts/estudio');
    for (const f of FONTS) expect(existsSync(join(here, f.file.split('/').pop()!))).toBe(true);
  });

  (existsSync(fonts) ? it : it.skip)('as fontes são os mesmos ficheiros do site', () => {
    const here = join(__dirname, '../../assets/fonts/estudio');
    const site = readdirSync(fonts).filter((f) => f.endsWith('.woff2')).sort();
    expect(readdirSync(here).filter((f) => f.endsWith('.woff2')).sort()).toEqual(site);
    for (const f of site) expect(sha(join(here, f))).toBe(sha(join(fonts, f)));
  });
});
