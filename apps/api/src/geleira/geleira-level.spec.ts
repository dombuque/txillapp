import { basePoints, progressOf, rawLevel, settle, tipFor, type LevelBreakdown } from './geleira-level';

const bd = (o: Partial<LevelBreakdown> = {}): LevelBreakdown => ({
  geladas: { points: 0, paid: 0, received: 0 },
  brindes: { points: 0, people: 0 },
  sitios: { points: 0, places: 0, visits: 0 },
  rodadas: { points: 0, joined: 0, paid: 0 },
  gostos: { points: 0, max: 8, groups: 0, rated: 0 },
  people: 0,
  weeks: 0,
  raw: 0,
  ...o,
});

describe('nível da geleira: as contas sem base de dados', () => {
  it('gostos: 1 por grupo (até 4) e 1 por cada 2 notas (até 4), no máximo 8', () => {
    expect(basePoints(0, 0)).toBe(0);
    expect(basePoints(3, 3)).toBe(4);
    expect(basePoints(20, 30)).toBe(8);
  });

  it('o nível pede pontos, pessoas diferentes e semanas', () => {
    expect(rawLevel({ points: 0, people: 0, weeks: 0 })).toBe(0);
    expect(rawLevel({ points: 39, people: 9, weeks: 9 })).toBe(1);
    expect(rawLevel({ points: 60, people: 1, weeks: 9 })).toBe(1); // uma pessoa só
    expect(rawLevel({ points: 60, people: 2, weeks: 3 })).toBe(2);
    expect(rawLevel({ points: 150, people: 4, weeks: 9 })).toBe(2);
    expect(rawLevel({ points: 150, people: 5, weeks: 6 })).toBe(3);
    expect(rawLevel({ points: 400, people: 9, weeks: 13 })).toBe(3);
    expect(rawLevel({ points: 180, people: 10, weeks: 10 })).toBe(4);
  });

  it('sobe logo, desce um degrau por semana', () => {
    const t0 = new Date('2026-06-01T00:00:00Z');
    const day = (n: number) => new Date(t0.getTime() + n * 86_400_000);
    expect(settle(null, 3, t0)).toEqual({ level: 3, droppedAt: null });
    expect(settle({ level: 1, droppedAt: null }, 4, t0)).toEqual({ level: 4, droppedAt: null });
    expect(settle({ level: 4, droppedAt: null }, 0, t0)).toEqual({ level: 3, droppedAt: t0 });
    expect(settle({ level: 3, droppedAt: t0 }, 0, day(6))).toEqual({ level: 3, droppedAt: t0 });
    expect(settle({ level: 3, droppedAt: t0 }, 0, day(7))).toEqual({ level: 2, droppedAt: day(7) });
  });

  it('a barra é o requisito mais atrasado', () => {
    expect(progressOf({ points: 20, level: 1, breakdown: { people: 2, weeks: 3 } })).toBe(0.49);
    expect(progressOf({ points: 39, level: 1, breakdown: { people: 1, weeks: 3 } })).toBe(0.5);
    expect(progressOf({ points: 999, level: 4, breakdown: { people: 0, weeks: 0 } })).toBe(1);
  });

  it('a dica diz o que falta, em coisas concretas', () => {
    expect(tipFor({ points: 94, level: 2, breakdown: bd({ people: 6, weeks: 9, raw: 2 }) }, 'Paulada garantida')).toBe('Paga 2 geladas ou recebe brindes de 6 amigos para chegares a Paulada garantida.');
    expect(tipFor({ points: 70, level: 2, breakdown: bd({ people: 3, weeks: 9, raw: 2 }) }, 'Paulada garantida')).toBe(
      'Paga 10 geladas ou faz 15 check-ins em sítios diferentes e txila com mais 2 pessoas diferentes para chegares a Paulada garantida.',
    );
    expect(tipFor({ points: 120, level: 2, breakdown: bd({ people: 5, weeks: 5, raw: 2 }) }, 'Paulada garantida')).toBe('Sai com a malta em mais 1 semana para chegares a Paulada garantida.');
    expect(tipFor({ points: 0, level: 0, breakdown: bd() }, 'A txilar')).toMatch(/começares a txilar/);
    expect(tipFor({ points: 300, level: 4, breakdown: bd({ raw: 4 }) }, null)).toMatch(/^Estás no topo/);
    expect(tipFor({ points: 10, level: 3, breakdown: bd({ raw: 1 }) }, 'Lenda da paulada')).toMatch(/desce um degrau por semana/);
    expect(tipFor({ points: 0, level: 2, breakdown: bd({ raw: 0 }) }, 'X')).not.toMatch(/álcool/);
  });
});
