import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NEEDS, StaffGuard } from './staff.guard';

/** Todos os ficheiros *.controller.ts da API. */
function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return controllerFiles(p);
    return f.endsWith('.controller.ts') ? [p] : [];
  });
}

/**
 * O guard da rede social (JwtAuthGuard) deixa passar sem sessão as rotas marcadas com @Needs (são da equipa, com login
 * próprio). Por isso cada rota com @Needs TEM de ter o StaffGuard (no método ou na classe): sem ele ficava aberta a toda a
 * gente. Este teste lê todos os controladores e falha se alguma rota da equipa ficar sem o guard da equipa.
 */
describe('rotas da equipa (@Needs) têm sempre o StaffGuard', () => {
  it('nenhuma rota com @Needs fica sem o StaffGuard', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of controllerFiles(join(__dirname, '..'))) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(file) as Record<string, unknown>;
      for (const C of Object.values(mod)) {
        if (typeof C !== 'function' || Reflect.getMetadata(PATH_METADATA, C) === undefined) continue;
        const classNeeds = Reflect.getMetadata(NEEDS, C) as unknown;
        const classGuards = (Reflect.getMetadata(GUARDS_METADATA, C) as unknown[] | undefined) ?? [];
        const proto = (C as { prototype: Record<string, unknown> }).prototype;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const h = proto[name];
          if (name === 'constructor' || typeof h !== 'function' || Reflect.getMetadata(PATH_METADATA, h) === undefined) continue;
          const needs = (Reflect.getMetadata(NEEDS, h) as unknown) ?? classNeeds;
          if (!needs) continue;
          checked++;
          const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, h) as unknown[] | undefined) ?? [])];
          if (!guards.includes(StaffGuard)) missing.push(`${(C as { name: string }).name}.${name}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });
});
