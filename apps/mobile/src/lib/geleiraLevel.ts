// O nível da geleira (0146): o que a pessoa vive com a malta nos últimos 90 dias. O servidor faz a conta e manda o nível, a
// barra e, só ao dono, o detalhe e a dica; aqui ficam os textos e as linhas do «Como subo?». Sem dependências (os testes
// correm em Node: tests/geleiraLevel.test.mjs).

/** Os pontos de cada nível (0 a 4), se o servidor não os mandar. */
export const LEVEL_STEPS = [0, 1, 40, 100, 180] as const;
/** O que os níveis de cima pedem além dos pontos: pessoas diferentes e semanas com atividade. */
export const LEVEL_GATES = [
  { people: 0, weeks: 0 },
  { people: 0, weeks: 0 },
  { people: 2, weeks: 3 },
  { people: 5, weeks: 6 },
  { people: 10, weeks: 10 },
] as const;

export interface LevelDetail {
  days: number;
  geladas: { points: number; paid: number; received: number };
  brindes: { points: number; people: number };
  sitios: { points: number; places: number; visits: number };
  rodadas: { points: number; joined: number; paid: number };
  gostos: { points: number; max: number; groups: number; rated: number };
  people: number;
  weeks: number;
  needs: { points: number; people: number; weeks: number } | null;
  falling: boolean;
}

export type LevelIcon = 'soda' | 'cheers' | 'map-pin' | 'users' | 'snowflake';
export interface LevelRow { key: 'geladas' | 'brindes' | 'sitios' | 'rodadas' | 'gostos'; icon: LevelIcon; label: string; points: number; note: string }

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const pl = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** As cinco linhas do detalhe, com ícone, nome, pontos e uma nota (o que já conta, ou como começar). */
export function levelRows(d: LevelDetail): LevelRow[] {
  const g = d.geladas, b = d.brindes, s = d.sitios, r = d.rodadas, t = d.gostos;
  return [
    { key: 'geladas', icon: 'soda', label: 'Geladas', points: n(g.points), note: n(g.paid) + n(g.received) ? `${pl(n(g.paid), 'paga', 'pagas')} · ${pl(n(g.received), 'recebida', 'recebidas')}` : 'Paga ou recebe uma gelada (confirmada)' },
    { key: 'brindes', icon: 'cheers', label: 'Brindes', points: n(b.points), note: n(b.people) ? `de ${pl(n(b.people), 'amigo', 'amigos')}` : 'Brindes de amigos que te seguem e que segues' },
    { key: 'sitios', icon: 'map-pin', label: 'Sítios', points: n(s.points), note: n(s.places) ? `${pl(n(s.places), 'local', 'locais')} · ${pl(n(s.visits), 'check-in', 'check-ins')}` : 'Faz check-in com o QR do local' },
    { key: 'rodadas', icon: 'users', label: 'Rodadas', points: n(r.points), note: n(r.joined) + n(r.paid) ? `${pl(n(r.joined), 'entrada', 'entradas')} · ${pl(n(r.paid), 'paga', 'pagas')}` : 'Entra ou paga uma rodada no TxillGroup' },
    { key: 'gostos', icon: 'snowflake', label: 'Gostos', points: n(t.points), note: `${pl(n(t.groups), 'grupo', 'grupos')} · ${pl(n(t.rated), 'com nota', 'com nota')} (máx. ${n(t.max) || 8})` },
  ];
}

/** A barra (0 a 1): a do servidor; sem ela (servidor antigo), pelos pontos dentro do nível. */
export function levelBar(lv: { level: number; points: number; progress?: number; steps?: readonly number[] } | undefined): number {
  if (!lv) return 0;
  if (typeof lv.progress === 'number' && Number.isFinite(lv.progress)) return Math.max(0, Math.min(1, lv.progress));
  const steps = lv.steps && lv.steps.length === 5 ? lv.steps : LEVEL_STEPS;
  if (lv.level >= 4) return 1;
  const lo = steps[lv.level] ?? 0, hi = steps[lv.level + 1] ?? lo + 1;
  return Math.max(0, Math.min(1, (n(lv.points) - lo) / Math.max(1, hi - lo)));
}

/** O que cada nível pede, numa linha («40+ pontos · 2 pessoas · 3 semanas»). */
export function stepNeeds(level: number, steps: readonly number[] = LEVEL_STEPS): string {
  if (level <= 0) return '0 pontos';
  const g = LEVEL_GATES[level] ?? { people: 0, weeks: 0 };
  return [`${steps[level] ?? LEVEL_STEPS[level]}+ pontos`, g.people ? pl(g.people, 'pessoa', 'pessoas') : '', g.weeks ? pl(g.weeks, 'semana', 'semanas') : ''].filter(Boolean).join(' · ');
}

/** O que ainda falta, curto («Faltam 6 pontos e 2 pessoas»); null no topo ou se não falta nada. */
export function needsText(needs: LevelDetail['needs']): string | null {
  if (!needs) return null;
  const parts = [n(needs.points) ? pl(n(needs.points), 'ponto', 'pontos') : '', n(needs.people) ? pl(n(needs.people), 'pessoa', 'pessoas') : '', n(needs.weeks) ? pl(n(needs.weeks), 'semana', 'semanas') : ''].filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0].startsWith('1 ') ? 'Falta' : 'Faltam';
  return `${first} ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`}`;
}

/** A regra, para quem pergunta (a mesma dos Termos e da Ajuda). */
export const LEVEL_RULES =
  'Contam os últimos 90 dias: geladas pagas e confirmadas, brindes de amigos, check-ins em sítios e rodadas no TxillGroup, e um pouco dos teus gostos. O álcool não conta (um refresco vale o mesmo) e os Txills também não. A mesma pessoa vale no máximo 6 pontos por semana. Se deixares de sair, o nível desce devagar: no máximo um por semana.';
