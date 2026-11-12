import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Lembretes de regresso: as regras (etapas, limites e horas) e os textos. Sem base de dados, para se poder testar à parte.
 * O serviço que os envia está em comeback-reminder.service.ts.
 */

/** Dias sem abrir a app em que cada etapa fica pronta: 1.ª aos 3, 2.ª aos 7, 3.ª aos 14 e depois uma por mês (30 e 60). */
export const STAGE_DAYS = [3, 7, 14, 30, 60] as const;
/** Ao fim de tantos dias sem abrir, pára de vez (até a pessoa voltar). */
export const STOP_AFTER_DAYS = 90;
/** Nunca mais de um lembrete em cada 7 dias seguidos, por pessoa (também entre ciclos: voltar e sair outra vez não o fura). */
export const MIN_GAP_DAYS = 7;
/** Depois dos 30 dias, no máximo um por mês: a etapa 5 só sai 28 dias ou mais depois do lembrete anterior. */
export const MONTHLY_GAP_DAYS = 28;
/** Horas em que se pode enviar, na hora de Moçambique (UTC+2, sem hora de verão): das 9h00 às 19h59. */
export const SEND_FROM_HOUR = 9;
export const SEND_UNTIL_HOUR = 20;
/** O aviso que não chegou até às 21h00 de Maputo já não chega (nunca de noite nem de madrugada). */
export const EXPIRE_AT_HOUR = 21;

export type ComebackKind = 'messages' | 'posts' | 'stories' | 'cheers' | 'generic';

/** A hora (0–23) em Maputo. */
export const maputoHour = (now: Date) => (now.getUTCHours() + 2) % 24;

/** Pode-se enviar a esta hora? */
export const sendingHours = (now: Date) => {
  const h = maputoHour(now);
  return h >= SEND_FROM_HOUR && h < SEND_UNTIL_HOUR;
};

/** Quantos segundos faltam até às 21h00 de Maputo (a validade do push), no mínimo 1 hora. */
export function ttlUntilEvening(now: Date): number {
  const end = new Date(now);
  end.setUTCHours(EXPIRE_AT_HOUR - 2, 0, 0, 0);
  return Math.max(3600, Math.floor((end.getTime() - now.getTime()) / 1000));
}

/** A etapa que já devia ter saído com tantos dias sem abrir (0 = ainda nenhuma; null = passou dos 90 dias). */
export function dueStage(daysAway: number): number | null {
  if (daysAway >= STOP_AFTER_DAYS) return null;
  let s = 0;
  STAGE_DAYS.forEach((d, i) => {
    if (daysAway >= d) s = i + 1;
  });
  return s;
}

/** O que existe mesmo para esta pessoa desde a última visita (tudo já filtrado: sem bloqueados nem conteúdo que não pode ver). */
export interface ComebackFacts {
  /** Mensagens por ler nas conversas (sem os pedidos de mensagem). */
  unreadMessages: number;
  /** Quem segue e publicou: quantas pessoas e o primeiro nome da mais recente (com o artigo, se ela mostra o género). */
  posters: { people: number; name: string; article: 'A' | 'O' | null } | null;
  /** Mimos novos (stories ainda no ar) de quem segue. */
  newStories: number;
  /** A coisa minha que mais brindes recebeu desde a última visita. */
  cheers: { count: number; target: 'post' | 'tcheka' | 'story'; url: string } | null;
}

export interface ComebackMessage {
  kind: ComebackKind;
  title: string;
  body: string;
  /** Caminho dentro da app (o toque abre aqui). */
  url: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Textos sem nada de concreto: curtos, simpáticos, no tom da app. */
export const GENERIC: { title: string; body: string }[] = [
  { title: 'A malta anda por aqui', body: 'A malta anda por aqui. Bora ver o que se passa?' },
  { title: 'Saudades tuas', body: 'Já há uns dias que não passas pelo Txillapp. Vem dar uma espreitadela!' },
  { title: 'O Txillapp continua a mexer', body: 'Há sempre alguma coisa a acontecer por cá. Bora ver?' },
  { title: 'Passa por cá', body: 'O teu Início está à tua espera. Dá um saltinho!' },
];

/**
 * Escolhe o texto. Usa só o que existe mesmo para a pessoa; com várias coisas, roda com a etapa (para os lembretes
 * seguidos não dizerem o mesmo) e o texto também varia com a etapa. Sem nada: um dos textos simpáticos.
 * Nunca leva conteúdo (só números e o primeiro nome de quem a pessoa segue e pode ver).
 */
export function composeMessage(f: ComebackFacts, stage: number): ComebackMessage {
  const v = Math.max(0, stage - 1);
  const options: ComebackMessage[] = [];
  if (f.unreadMessages > 0) {
    const n = f.unreadMessages;
    const bodies = [`Tens ${n} ${plural(n, 'mensagem', 'mensagens')} por ler.`, `Tens ${n} ${plural(n, 'mensagem', 'mensagens')} por ler. Bora responder?`];
    options.push({ kind: 'messages', title: plural(n, 'Uma mensagem à tua espera', 'Mensagens à tua espera'), body: bodies[v % bodies.length], url: '/messages' });
  }
  if (f.cheers && f.cheers.count > 0) {
    const n = f.cheers.count;
    const what = f.cheers.target === 'story' ? 'O teu mimo' : f.cheers.target === 'tcheka' ? 'A tua tcheka' : 'A tua publicação';
    const bodies = [`${what} recebeu ${n} ${plural(n, 'brinde', 'brindes')}.`, `${what} recebeu ${n} ${plural(n, 'brinde', 'brindes')} enquanto estiveste fora. Vem ver!`];
    options.push({ kind: 'cheers', title: plural(n, 'Brindaram-te', 'A malta brindou-te'), body: bodies[v % bodies.length], url: f.cheers.url });
  }
  if (f.posters && f.posters.people > 0) {
    const who = f.posters.article ? `${f.posters.article} ${f.posters.name}` : f.posters.name;
    const others = f.posters.people - 1;
    const body = others > 0 ? `${who} e mais ${others} publicaram desde a tua última visita.` : `${who} publicou desde a tua última visita.`;
    options.push({ kind: 'posts', title: 'Novidades no teu Início', body, url: '/' });
  }
  if (f.newStories > 0) {
    const n = f.newStories;
    options.push({ kind: 'stories', title: plural(n, 'Um mimo novo', 'Mimos novos'), body: `Há ${n} ${plural(n, 'mimo novo', 'mimos novos')} de quem segues.`, url: '/' });
  }
  if (options.length) return options[v % options.length];
  const g = GENERIC[v % GENERIC.length];
  return { kind: 'generic', title: g.title, body: g.body, url: '/' };
}

/** O primeiro nome que se mostra (nunca vazio: o @ se não houver nome). */
export function firstName(displayName: string | null | undefined, username: string): string {
  const n = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  return (n || username).slice(0, 30);
}

// ---------- "Deixar de receber estes lembretes": token de um clique, sem entrar na conta ----------

const UNSUB_LABEL = 'txillapp-comeback-unsubscribe:';
const sign = (secret: string, userId: string) => createHmac('sha256', secret).update(UNSUB_LABEL + userId).digest('base64url');

/** `<id da conta>.<assinatura>`: não expira (a ligação no e-mail deve funcionar sempre) e só serve para isto. */
export const unsubscribeToken = (secret: string, userId: string) => `${userId}.${sign(secret, userId)}`;

/** A conta do token, se a assinatura confere. */
export function verifyUnsubscribeToken(secret: string, token: string): string | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
  if (!m) return null;
  const want = Buffer.from(sign(secret, m[1]));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1] : null;
}
