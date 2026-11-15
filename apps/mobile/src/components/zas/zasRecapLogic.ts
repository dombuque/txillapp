/**
 * O resumo semanal dos Zás e os Zás guardados (só para mim, 7 dias): as contas e os textos puros, sem React nem módulos
 * nativos (os testes em tests/zasRecap.test.mjs importam este ficheiro diretamente). As datas contam na hora de Moçambique
 * (UTC+2, sem hora de verão), como o servidor que gera o resumo ao domingo à noite.
 */

const DAY = 86_400_000;
const MZ_OFFSET = 2 * 3_600_000;
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

type Kept = { active?: boolean; keepUntil?: string | null; expiresAt: string };
type Recap = { label: string; count: number; expiresAt: string; published: { audience: 'all' | 'close_friends' } | null };

/** A data em Moçambique (os campos UTC deste Date são os de Maputo). */
const mz = (iso: string) => new Date(new Date(iso).getTime() + MZ_OFFSET);

/** Um Zás meu guardado: já passou das 24 h e só eu o vejo (até `keepUntil`). Sem `active` (servidor antigo): ativo. */
export const isKept = (it: { active?: boolean }) => it.active === false;

/** Quantos dias faltam (arredondado para cima, pelo menos 1). */
export function daysLeft(iso: string, now = Date.now()): number {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - now) / DAY));
}

/** «1 dia», «3 dias». */
export const daysText = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

/** Até quando um Zás meu fica comigo: o guardado até `keepUntil` (ou o fim das 24 h, se o servidor não mandou). */
export const keptUntil = (it: Kept) => it.keepUntil ?? it.expiresAt;

/** A marca na grelha de «Os meus Zás»: o ativo mostra as horas que faltam («5h»); o guardado «Só tu · 6 dias». */
export function gridBadge(it: Kept, now = Date.now()): string {
  if (!isKept(it)) return `${Math.max(1, Math.ceil((new Date(it.expiresAt).getTime() - now) / 3_600_000))}h`;
  return `Só tu · ${daysText(daysLeft(keptUntil(it), now))}`;
}

/** «ter., 10 nov» (hora de Moçambique). */
export function shortDay(iso: string): string {
  const d = mz(iso);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** «22 de novembro» (hora de Moçambique). */
export function longDay(iso: string): string {
  const d = mz(iso);
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}

/** No visor dos meus, por baixo do Zás guardado: «só tu vês · apaga-se daqui a 3 dias» (amanhã / hoje no fim). */
export function keptViewerLine(it: Kept, now = Date.now()): string {
  const left = new Date(keptUntil(it)).getTime() - now;
  const when = left < DAY ? 'apaga-se hoje' : left < 2 * DAY ? 'apaga-se amanhã' : `apaga-se daqui a ${daysText(daysLeft(keptUntil(it), now))}`;
  return `só tu vês · ${when}`;
}

/** O cartão do resumo em «Os meus Zás» e a linha da notificação: «8–15 nov · 12 Zás». */
export const recapLine = (r: { label: string; count: number }) => `${r.label} · ${r.count} Zás`;

/** O título do ecrã do resumo: «Resumo dos Zás · 8–15 nov». */
export const recapTitle = (r: { label: string }) => `Resumo dos Zás · ${r.label}`;

/** Para quem foi o resumo publicado. */
export const audienceLabel = (a: 'all' | 'close_friends') => (a === 'close_friends' ? 'Amigos próximos' : 'Amigos');

/**
 * A linha por baixo da imagem do resumo. Por partilhar: «Só tu vês isto até o partilhares. Apaga-se a 22 de novembro.»
 * Publicado: «Está nos teus mimos (Amigos próximos). O resumo apaga-se a 22 de novembro.»
 */
export function recapPrivacyLine(r: Recap): string {
  const day = longDay(r.expiresAt);
  if (r.published) return `Está nos teus mimos (${audienceLabel(r.published.audience)}). O resumo apaga-se a ${day}.`;
  return `Só tu vês isto até o partilhares. Apaga-se a ${day}.`;
}

/**
 * O que «Os meus Zás» mostra no topo: o cartão do resumo quando há um; sem resumo e com a definição ligada, a linha
 * discreta «O teu resumo chega ao domingo à noite»; desligada (ou servidor antigo, sem a definição), nada.
 */
export function recapSlot(keep: boolean | null | undefined, recap: unknown | null | undefined): 'card' | 'hint' | null {
  if (recap) return 'card';
  return keep === true ? 'hint' : null;
}
export const RECAP_HINT = 'O teu resumo chega ao domingo à noite';

/** «Os meus Zás» vazio. */
export function emptyText(keep: boolean | null | undefined): string {
  return keep === true
    ? 'Ainda não tens Zás. Os outros veem os teus Zás 24 h; para ti ficam 7 dias, para o resumo da semana.'
    : 'Não tens Zás ativos. Os Zás duram 24 h.';
}

/** A linha do relógio na introdução do Zás. */
export function introDuration(keep: boolean | null | undefined): string {
  return keep === true
    ? 'Os outros veem-no 24 horas. Para ti fica 7 dias, para o resumo da semana (podes desligar nas Definições).'
    : 'Dura 24 horas.';
}

/** O «Apagar» do menu de um Zás meu, e a confirmação. */
export function deleteTexts(it: { active?: boolean }): { menu: string; title: string; body: string } {
  return isKept(it)
    ? { menu: 'Apaga já o Zás guardado.', title: 'Apagar o Zás guardado?', body: 'Só tu o vias. Apaga-se já e não dá para o recuperar.' }
    : { menu: 'Desaparece para toda a gente.', title: 'Apagar o Zás?', body: 'Desaparece para toda a gente e não dá para o recuperar.' };
}

/** Notificação `zas_recap`: o texto, a linha de baixo e para onde leva. */
export const RECAP_NOTICE = 'O teu resumo dos Zás da semana está pronto 🎉';
export function recapNoticeSub(data: { label?: string; count?: number }): string | undefined {
  if (!data.label) return undefined;
  return typeof data.count === 'number' ? recapLine({ label: data.label, count: data.count }) : data.label;
}
export const recapNoticeTarget = (data: { recapId?: string }) => (data.recapId ? `/zas-resumo?id=${encodeURIComponent(data.recapId)}` : '/zas-resumo');

/** A confirmação antes de desligar a definição (o que se apaga logo). */
export const KEEP_OFF_PROMPT = {
  title: 'Desligar o resumo semanal?',
  message: 'Os teus Zás passam a apagar-se às 24 horas e deixa de haver resumo. Os Zás guardados que já passaram das 24 horas e o resumo por partilhar apagam-se já.',
  confirm: 'Desligar',
};

/** O erro ao publicar nos mimos: 409 = já lá está. */
export function publishErrorText(status: number | undefined, message?: string): string {
  if (status === 409) return 'Este resumo já está nos teus mimos.';
  if (status === 404) return 'Este resumo já não existe.';
  return message || 'Não consegui partilhar agora. Tenta outra vez.';
}

/** O tamanho do cartão 9:16 que cabe em `w`×`h` (inteiro, pelo menos 120 de largura). */
export function recapCardSize(w: number, h: number): { w: number; h: number } {
  const cw = Math.max(120, Math.floor(Math.min(w, (h * 9) / 16)));
  return { w: cw, h: Math.round((cw * 16) / 9) };
}
