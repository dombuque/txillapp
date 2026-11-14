import { CHALLENGE_KINDS, commonTopics, cosine, hash, matchScore, mixarDay, normalize, onlyOf, pickChallenge, pickDaily, prevDay, scoreCandidates, streakOf, type Candidate } from './mixar-pick';

const cand = (id: string, topics: string[], extra: Partial<Candidate> = {}): Candidate => ({ id, authorId: `au-${id}`, topics, quality: 0.5, video: true, ...extra });

describe('Mixar: o algoritmo (mixar-pick)', () => {
  const dom = { humor: 10, musica: 6, desporto: 4 };
  const ana = { humor: 8, moda: 7, musica: 3 };

  it('normaliza pelos positivos e guarda os negativos', () => {
    expect(normalize({ a: 3, b: 1, c: -2 })).toEqual({ a: 0.75, b: 0.25, c: -0.5 });
    expect(normalize({})).toEqual({});
  });

  it('cosseno e match: iguais dão 100, nada em comum dá 0, sem perfil dá 0', () => {
    expect(cosine(dom, dom)).toBeCloseTo(1);
    expect(matchScore(dom, dom)).toBe(100);
    expect(matchScore({ humor: 1 }, { moda: 1 })).toBe(0);
    expect(matchScore({}, ana)).toBe(0);
    const m = matchScore(dom, ana);
    expect(m).toBeGreaterThan(40);
    expect(m).toBeLessThan(100);
    // Os «menos» (negativos) não contam para o match.
    expect(matchScore({ humor: 1, moda: -5 }, { humor: 1 })).toBe(100);
  });

  it('temas em comum do mais forte para o mais fraco, e o que é só de cada um', () => {
    const c = commonTopics(dom, ana);
    expect(c.map((x) => x.topic)).toEqual(['humor', 'musica']);
    expect(c[0].score).toBe(100);
    expect(c[1].score).toBeLessThan(100);
    expect(onlyOf(dom, ana)).toEqual(['desporto']);
    expect(onlyOf(ana, dom)).toEqual(['moda']);
    expect(commonTopics({ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 1 }, { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 1 })).toHaveLength(8);
  });

  it('classifica cada publicação: dos dois, só de um, só do outro; um «menos» tira-a', () => {
    const s = scoreCandidates({
      a: { ...dom, festa: -10 },
      b: ana,
      candidates: [cand('h', ['humor']), cand('d', ['desporto']), cand('m', ['moda']), cand('x', ['cinema']), cand('f', ['festa', 'humor'])],
    });
    const by = Object.fromEntries(s.map((x) => [x.postId, x]));
    expect(by.h).toMatchObject({ from: 'both', topic: 'humor' });
    expect(by.d).toMatchObject({ from: 'a', topic: 'desporto' });
    expect(by.m).toMatchObject({ from: 'b', topic: 'moda' });
    expect(by.x).toMatchObject({ from: 'both', topic: null });
    expect(by.f).toBeUndefined();
    // Os temas em comum ficam à frente.
    expect(s[0].postId).toBe('h');
  });

  it('a seleção: até 24, ~60% dos dois, um pouco de cada lado, no máximo 2 por autor, sem repetir dias anteriores', () => {
    const cands: Candidate[] = [];
    for (let i = 0; i < 40; i++) cands.push(cand(`h${i}`, ['humor', 'musica'], { authorId: `ah${i % 20}` }));
    for (let i = 0; i < 10; i++) cands.push(cand(`d${i}`, ['desporto']));
    for (let i = 0; i < 10; i++) cands.push(cand(`m${i}`, ['moda']));
    const out = pickDaily({ a: dom, b: ana, candidates: cands, exclude: ['h0', 'h1'], seed: 's' });
    expect(out).toHaveLength(24);
    expect(new Set(out.map((o) => o.postId)).size).toBe(24);
    expect(out.find((o) => o.postId === 'h0' || o.postId === 'h1')).toBeUndefined();
    const count = (f: string) => out.filter((o) => o.from === f).length;
    expect(count('both')).toBe(14);
    expect(count('a')).toBe(5);
    expect(count('b')).toBe(5);
    // A ordem intercala: os primeiros cinco seguem o padrão both, a, both, b, both.
    expect(out.slice(0, 5).map((o) => o.from)).toEqual(['both', 'a', 'both', 'b', 'both']);
    const authors = new Map<string, number>();
    for (const o of out) {
      const a = cands.find((c) => c.id === o.postId)!.authorId;
      authors.set(a, (authors.get(a) ?? 0) + 1);
    }
    expect(Math.max(...authors.values())).toBeLessThanOrEqual(2);
  });

  it('quando falta um lado, os outros enchem; sem perfis fica a qualidade', () => {
    const cands = Array.from({ length: 30 }, (_, i) => cand(`h${i}`, ['humor']));
    expect(pickDaily({ a: dom, b: ana, candidates: cands, max: 10 }).every((o) => o.from === 'both')).toBe(true);
    expect(pickDaily({ a: dom, b: ana, candidates: cands, max: 10 })).toHaveLength(10);
    const fresh = pickDaily({ a: {}, b: {}, candidates: [cand('p', ['x'], { quality: 0.1 }), cand('q', ['x'], { quality: 0.9 })] });
    expect(fresh.map((o) => o.postId)).toEqual(['q', 'p']);
    expect(fresh[0]).toMatchObject({ from: 'both', topic: null });
    expect(pickDaily({ a: dom, b: ana, candidates: [] })).toEqual([]);
  });

  it('o perfil do Mixar muda a seleção seguinte (o que reagiram sobe; o «nah» desce)', () => {
    const cands = [cand('mus', ['musica']), cand('hum', ['humor'])];
    const before = scoreCandidates({ a: { musica: 1, humor: 1 }, b: { musica: 1, humor: 1 }, candidates: cands, seed: 'x' });
    const after = scoreCandidates({ a: { musica: 1, humor: 1 }, b: { musica: 1, humor: 1 }, mixar: { musica: 3, humor: -2 }, candidates: cands, seed: 'x' });
    expect(after[0].postId).toBe('mus');
    const s = (arr: typeof before, id: string) => arr.find((x) => x.postId === id)!.score;
    expect(s(after, 'mus')).toBeGreaterThan(s(before, 'mus'));
    expect(s(after, 'hum')).toBeLessThan(s(before, 'hum'));
  });

  it('é estável: a mesma semente dá a mesma seleção', () => {
    const cands = Array.from({ length: 30 }, (_, i) => cand(`p${i}`, ['humor']));
    expect(pickDaily({ a: dom, b: ana, candidates: cands, seed: 'dia' })).toEqual(pickDaily({ a: dom, b: ana, candidates: cands, seed: 'dia' }));
    expect(hash('abc')).toBe(hash('abc'));
  });

  it('o desafio: 3 opções com poucos itens, 4 com 8 ou mais, nenhum com menos de 3; «mais engraçado» só com humor', () => {
    const items = (n: number, topic: string | null = 'moda') => Array.from({ length: n }, (_, i) => ({ postId: `p${i}`, video: i % 2 === 0, score: n - i, topic }));
    expect(pickChallenge(items(2), 's')).toBeNull();
    expect(pickChallenge(items(5), 's')!.options).toHaveLength(3);
    const c = pickChallenge(items(12), 's')!;
    expect(c.options).toHaveLength(4);
    expect(new Set(c.options).size).toBe(4);
    expect(CHALLENGE_KINDS).toContain(c.kind);
    for (let i = 0; i < 30; i++) expect(pickChallenge(items(6), `s${i}`)!.kind).not.toBe('mais_engracado');
    const kinds = new Set(Array.from({ length: 40 }, (_, i) => pickChallenge(items(6, 'humor'), `s${i}`)!.kind));
    expect(kinds.has('mais_engracado')).toBe(true);
  });

  it('a série conta os dias seguidos até hoje (ou até ontem, se hoje ainda não jogaram)', () => {
    expect(prevDay('2026-03-01')).toBe('2026-02-28');
    expect(streakOf([], '2026-11-14')).toBe(0);
    expect(streakOf(['2026-11-14', '2026-11-13', '2026-11-12', '2026-11-10'], '2026-11-14')).toBe(3);
    expect(streakOf(['2026-11-13', '2026-11-12'], '2026-11-14')).toBe(2);
    expect(streakOf(['2026-11-12'], '2026-11-14')).toBe(0);
  });

  it('o dia do Mixar muda às 05:00 de Maputo', () => {
    expect(mixarDay(new Date('2026-11-14T02:59:00Z'))).toBe('2026-11-13'); // 04:59 em Maputo
    expect(mixarDay(new Date('2026-11-14T03:00:00Z'))).toBe('2026-11-14'); // 05:00 em Maputo
    expect(mixarDay(new Date('2026-11-14T21:30:00Z'))).toBe('2026-11-14'); // 23:30 em Maputo
  });
});
