import sharp from 'sharp';
import { controlCandidates, dropTopics, emptyControl, LESS_AUTHOR, LESS_TOPIC, maskTopic } from './mixar-controlo';
import { pickDaily, scoreCandidates, type Candidate } from './mixar-pick';
import { renderWeekCard, weekStatLines } from './mixar-week-card';

/** O controlo do Mixar (0172) sem base de dados: os temas privados, 'off' e 'less', e o cartão da semana. */
describe('Mixar: controlo dos temas (puro)', () => {
  const cand = (id: string, topics: string[], authorId = `au-${id}`, quality = 0.5): Candidate => ({ id, authorId, topics, quality, video: true });

  it('dropTopics tira os temas de todas as listas, sem mexer no original', () => {
    const w = { musica: 2, fe: 1, humor: 3 };
    expect(dropTopics(w, new Set(['fe']), ['humor'])).toEqual({ musica: 2 });
    expect(w).toEqual({ musica: 2, fe: 1, humor: 3 });
  });

  it('controlCandidates: sem os que têm um tema off; less no tema e no autor multiplicam (e acumulam)', () => {
    const ctl = { ...emptyControl(), off: new Set(['fe']), less: new Set(['humor']), lessAuthors: new Set(['zeca']) };
    const out = controlCandidates([cand('a', ['fe', 'musica']), cand('b', ['humor']), cand('c', ['musica'], 'zeca'), cand('d', ['humor'], 'zeca'), cand('e', ['musica'])], ctl);
    expect(out.map((c) => c.id)).toEqual(['b', 'c', 'd', 'e']);
    expect(out.find((c) => c.id === 'b')!.boost).toBeCloseTo(LESS_TOPIC);
    expect(out.find((c) => c.id === 'c')!.boost).toBeCloseTo(LESS_AUTHOR);
    expect(out.find((c) => c.id === 'd')!.boost).toBeCloseTo(LESS_TOPIC * LESS_AUTHOR);
    expect(out.find((c) => c.id === 'e')!.boost).toBeUndefined();
  });

  it('com «menos», a publicação desce na pontuação e na seleção (os outros sobem)', () => {
    const a = { musica: 1 };
    const b = { musica: 1 };
    const cands = [cand('x', ['musica'], 'zeca', 0.9), cand('y', ['musica'], 'lina', 0.5)];
    expect(scoreCandidates({ a, b, candidates: cands, seed: 's' })[0].postId).toBe('x');
    const ctl = { ...emptyControl(), lessAuthors: new Set(['zeca']) };
    const s = scoreCandidates({ a, b, candidates: controlCandidates(cands, ctl), seed: 's' });
    expect(s[0].postId).toBe('y');
    const picked = pickDaily({ a, b, candidates: controlCandidates(cands, ctl), max: 1, seed: 's' });
    expect(picked.map((p) => p.postId)).toEqual(['y']);
  });

  it('um tema privado fora do perfil: deixa de ser razão «do teu gosto» e de contar como em comum', () => {
    const a = dropTopics({ fe: 3, musica: 1 }, ['fe']);
    const b = { musica: 2, fe: 1 };
    const s = scoreCandidates({ a, b, candidates: [cand('x', ['fe']), cand('y', ['musica'])], seed: 's' });
    const x = s.find((p) => p.postId === 'x')!;
    // Só a Ana gosta de fé (no perfil que conta): é «dela», nunca «dos dois» nem do Dom.
    expect(x.from).toBe('b');
    expect(s.find((p) => p.postId === 'y')!.from).toBe('both');
  });

  it('maskTopic esconde o tema privado', () => {
    expect(maskTopic('fe', new Set(['fe']))).toBeNull();
    expect(maskTopic('musica', new Set(['fe']))).toBe('musica');
    expect(maskTopic(null, new Set())).toBeNull();
  });

  it('os textos dos números do cartão', () => {
    expect(weekStatLines({ streak: 1, challenge: { matches: 0, played: 0 }, videos: 1 })).toEqual([
      { value: '1', label: 'dia de série' },
      { value: '0', label: 'desafios jogados' },
      { value: '1', label: 'vídeo visto esta semana' },
    ]);
    expect(weekStatLines({ streak: 4, challenge: { matches: 3, played: 5 }, videos: 20 }).map((x) => x.value)).toEqual(['4', '3 de 5', '20']);
    for (const l of weekStatLines({ streak: 4, challenge: { matches: 3, played: 5 }, videos: 20 })) expect(l.label).not.toMatch(/[—–]/);
  });

  it('o cartão desenha-se em JPEG 1080×1920 (com selos e nomes compridos)', async () => {
    const jpg = await renderWeekCard({
      label: '10 a 16 nov',
      me: { name: 'Dom', seal: 'verified' },
      them: { name: 'Anastácia-Maria', seal: 'paid' },
      username: 'dom',
      mySeal: 'verified',
      streak: 3,
      challenge: { matches: 2, played: 3 },
      videos: 17,
      topics: ['Humor', 'Música', 'Cabelo e barbearia', 'Ciência e curiosidades', 'Comida'],
    });
    const m = await sharp(jpg).metadata();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 1080, 1920]);
  }, 30_000);
});
