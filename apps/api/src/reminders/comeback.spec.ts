import { GENERIC, composeMessage, dueStage, firstName, maputoHour, sendingHours, ttlUntilEvening, unsubscribeToken, verifyUnsubscribeToken, type ComebackFacts } from './comeback';

const none: ComebackFacts = { unreadMessages: 0, posters: null, newStories: 0, cheers: null };
const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 12, h, m));

describe('lembretes de regresso: regras e textos', () => {
  it('etapas aos 3, 7, 14, 30 e 60 dias; aos 90 pára', () => {
    expect([0, 2, 3, 6, 7, 13, 14, 29, 30, 59, 60, 89].map(dueStage)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(dueStage(90)).toBeNull();
    expect(dueStage(400)).toBeNull();
  });

  it('horas de Maputo (UTC+2): das 9h00 às 19h59, nunca de noite', () => {
    expect(maputoHour(utc(7))).toBe(9);
    expect(maputoHour(utc(23))).toBe(1);
    expect(sendingHours(utc(6, 59))).toBe(false); // 8h59
    expect(sendingHours(utc(7))).toBe(true); // 9h00
    expect(sendingHours(utc(17, 59))).toBe(true); // 19h59
    expect(sendingHours(utc(18))).toBe(false); // 20h00
    expect(sendingHours(utc(1))).toBe(false); // 3h00
    expect(ttlUntilEvening(utc(7))).toBe(12 * 3600);
    expect(ttlUntilEvening(utc(17, 30))).toBe(3600 + 1800);
    expect(ttlUntilEvening(utc(18, 30))).toBe(3600); // nunca menos de 1 hora
  });

  it('textos: plurais, artigo só com o género à vista, rotação entre o que existe, e o simpático quando não há nada', () => {
    expect(composeMessage({ ...none, unreadMessages: 1 }, 1)).toMatchObject({ kind: 'messages', body: 'Tens 1 mensagem por ler.', url: '/messages' });
    expect(composeMessage({ ...none, unreadMessages: 3 }, 1).body).toBe('Tens 3 mensagens por ler.');
    expect(composeMessage({ ...none, posters: { people: 5, name: 'Ana', article: 'A' } }, 1).body).toBe('A Ana e mais 4 publicaram desde a tua última visita.');
    expect(composeMessage({ ...none, posters: { people: 1, name: 'Zé', article: null } }, 1).body).toBe('Zé publicou desde a tua última visita.');
    expect(composeMessage({ ...none, newStories: 2 }, 1).body).toBe('Há 2 mimos novos de quem segues.');
    expect(composeMessage({ ...none, cheers: { count: 5, target: 'story', url: '/stories/eu' } }, 1)).toMatchObject({ body: 'O teu mimo recebeu 5 brindes.', url: '/stories/eu' });
    expect(composeMessage({ ...none, cheers: { count: 1, target: 'tcheka', url: '/p/x' } }, 1).body).toBe('A tua tcheka recebeu 1 brinde.');
    const all: ComebackFacts = { unreadMessages: 2, posters: { people: 2, name: 'Ana', article: null }, newStories: 1, cheers: { count: 3, target: 'post', url: '/p/1' } };
    expect([1, 2, 3, 4, 5].map((s) => composeMessage(all, s).kind)).toEqual(['messages', 'cheers', 'posts', 'stories', 'messages']);
    expect(composeMessage(none, 1)).toMatchObject({ kind: 'generic', body: 'A malta anda por aqui. Bora ver o que se passa?', url: '/' });
    expect(new Set([1, 2, 3, 4].map((s) => composeMessage(none, s).body)).size).toBe(GENERIC.length);
    expect(firstName('  Ana Maria ', 'ana')).toBe('Ana');
    expect(firstName('', 'ana_m')).toBe('ana_m');
  });

  it('token de "Deixar de receber": só serve para a conta certa e com o segredo certo', () => {
    const id = '0190a6b2-1c2d-7e3f-8a9b-0c1d2e3f4a5b';
    const t = unsubscribeToken('s'.repeat(40), id);
    expect(verifyUnsubscribeToken('s'.repeat(40), t)).toBe(id);
    expect(verifyUnsubscribeToken('x'.repeat(40), t)).toBeNull();
    expect(verifyUnsubscribeToken('s'.repeat(40), t.replace(id, '0190a6b2-1c2d-7e3f-8a9b-0c1d2e3f4a5c'))).toBeNull();
    expect(verifyUnsubscribeToken('s'.repeat(40), 'lixo')).toBeNull();
    expect(verifyUnsubscribeToken('s'.repeat(40), '')).toBeNull();
  });
});
