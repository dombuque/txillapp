import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * rules.ts é uma cópia fiel de apps/mobile/src/lib/tchekaRules.ts (as regras do estúdio). Quando os dois ficheiros estão
 * no repositório (depois de juntar o ramo do estúdio), têm de ser iguais abaixo da linha «---- cópia ----».
 */
describe('as regras da montagem são as do estúdio', () => {
  const app = join(__dirname, '../../../mobile/src/lib/tchekaRules.ts');
  const here = readFileSync(join(__dirname, 'rules.ts'), 'utf8');
  const body = (s: string) => s.replace(/\r\n/g, '\n').trim();

  it('a cópia traz o cabeçalho e as regras mínimas', () => {
    expect(here).toContain('// ---- cópia ----');
    expect(here).toMatch(/export const MIN_PHOTOS = 3;/);
  });

  (existsSync(app) ? it : it.skip)('igual a apps/mobile/src/lib/tchekaRules.ts', () => {
    expect(body(here.split('// ---- cópia ----')[1])).toBe(body(readFileSync(app, 'utf8')));
  });
});
