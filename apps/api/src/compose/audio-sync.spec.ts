import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * audio.ts é uma cópia fiel de apps/mobile/src/lib/studio/audioDsp.ts (o som do estúdio do site). Quando os dois ficheiros
 * estão no repositório, têm de ser iguais abaixo da linha «---- cópia ----».
 */
describe('o som da montagem é o do estúdio', () => {
  const app = join(__dirname, '../../../mobile/src/lib/studio/audioDsp.ts');
  const here = readFileSync(join(__dirname, 'audio.ts'), 'utf8');
  const body = (s: string) => s.replace(/\r\n/g, '\n').trim();

  it('a cópia traz o cabeçalho e os efeitos', () => {
    expect(here).toContain('// ---- cópia ----');
    expect(here).toMatch(/export function synthSfx\(/);
  });

  (existsSync(app) ? it : it.skip)('igual a apps/mobile/src/lib/studio/audioDsp.ts', () => {
    expect(body(here.split('// ---- cópia ----')[1])).toBe(body(readFileSync(app, 'utf8')));
  });
});
