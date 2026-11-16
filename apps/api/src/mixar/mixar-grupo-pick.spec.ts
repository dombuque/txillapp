import { groupCommon, groupMatch, groupOnlyMe, pickGroupDaily, scoreGroupCandidates } from './mixar-grupo-pick';
import { commonTopics, MAX_ITEMS, type Candidate, type Weights } from './mixar-pick';

const cand = (id: string, topics: string[], extra: Partial<Candidate> = {}): Candidate => ({ id, authorId: `au-${id}`, topics, quality: 0.5, video: true, ...extra });

describe('Mixar de grupo: o algoritmo (mixar-grupo-pick)', () => {
  const people: { id: string; w: Weights }[] = [
    { id: 'dom', w: { humor: 10, musica: 4 } },
    { id: 'ana', w: { humor: 8, moda: 6 } },
    { id: 'zeca', w: { humor: 6, desporto: 8 } },
  ];

  it('os fãs de cada publicação: «de todos» quando todos gostam, senão a lista de quem gosta', () => {
    const s = scoreGroupCandidates({ people, candidates: [cand('h', ['humor']), cand('m', ['moda']), cand('d', ['desporto']), cand('x', ['cozinha'])] });
    const by = Object.fromEntries(s.map((x) => [x.postId, x]));
    expect(by.h).toMatchObject({ from: 'all', fans: ['dom', 'ana', 'zeca'], topic: 'humor' });
    expect(by.m).toMatchObject({ from: 'some', fans: ['ana'] });
    expect(by.d).toMatchObject({ from: 'some', fans: ['zeca'] });
    // Sem gosto de ninguém: só para encher (sem fãs).
    expect(by.x.fans).toEqual([]);
    expect(by.h.score).toBeGreaterThan(by.m.score);
  });

  it('um tema que alguém marcou «menos» não aparece a ninguém', () => {
    const s = scoreGroupCandidates({ people: [...people.slice(0, 2), { id: 'zeca', w: { humor: 6, moda: -5 } }], candidates: [cand('m', ['moda']), cand('h', ['humor'])] });
    expect(s.map((x) => x.postId)).toEqual(['h']);
  });

  it('a seleção: até 24, sem repetir, no máximo 2 por autor, partilhado primeiro e o gosto de cada um pelo meio', () => {
    const candidates: Candidate[] = [];
    for (let i = 0; i < 20; i++) for (const t of ['humor', 'moda', 'desporto', 'musica']) candidates.push(cand(`${t}${i}`, [t], { authorId: `a${i % 15}` }));
    const out = pickGroupDaily({ people, candidates, seed: 's' });
    expect(out).toHaveLength(MAX_ITEMS);
    expect(new Set(out.map((x) => x.postId)).size).toBe(out.length);
    const per = new Map<string, number>();
    for (const x of out) {
      const a = candidates.find((c) => c.id === x.postId)!.authorId;
      per.set(a, (per.get(a) ?? 0) + 1);
    }
    expect(Math.max(...per.values())).toBeLessThanOrEqual(2);
    expect(out[0].from).toBe('all');
    // Cada um tem pelo menos um do seu gosto.
    for (const p of ['ana', 'zeca']) expect(out.some((x) => x.fans.length === 1 && x.fans[0] === p)).toBe(true);
    // A mesma semente dá a mesma seleção; nunca o que se exclui.
    expect(pickGroupDaily({ people, candidates, seed: 's' })).toEqual(out);
    const again = pickGroupDaily({ people, candidates, seed: 's', exclude: out.map((x) => x.postId) });
    expect(again.some((x) => out.some((y) => y.postId === x.postId))).toBe(false);
  });

  it('o match, os temas em comum e o que é só meu', () => {
    expect(groupMatch([{ a: 1 }, { a: 1 }, { a: 1 }])).toBe(100);
    expect(groupMatch([{ a: 1 }, { b: 1 }, { c: 1 }])).toBe(0);
    expect(groupMatch([])).toBe(0);
    expect(groupCommon(people.map((p) => p.w)).map((x) => x.topic)).toEqual(['humor']);
    expect(groupCommon([people[0].w, people[1].w])).toEqual(commonTopics(people[0].w, people[1].w, 8));
    expect(groupOnlyMe(people[0].w, [people[1].w, people[2].w])).toEqual(['musica']);
  });
});
