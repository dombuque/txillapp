/**
 * «Brindado por @fulano e outras N pessoas» (o campo `cheeredBy` das publicações, apps/api/src/posts/cheered-by.ts) e os
 * amigos próximos que brindaram, a flutuar sobre a foto ou o vídeo. Sem imports: corre também nos testes (tests/brindadoPor).
 *
 * O servidor só manda `cheeredBy` quando o dono deixa quem vê ver quem brindou (a definição «Quem repostou / brindou»);
 * sem ele (o dono não deixa, ou uma publicação guardada em cache antes disto) mostra-se só a contagem.
 */
import { t } from '@/lib/i18n';
export interface CheeredByUser {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified?: boolean;
  verifiedTier?: 'verified' | 'official' | 'paid' | null;
  /** Está nos meus amigos próximos (a lista dos mimos). */
  close: boolean;
  /** Sigo esta pessoa (servidores antigos não mandam: conta como não). */
  following?: boolean;
}
export interface CheeredBy {
  users: CheeredByUser[];
  total: number;
}

/** O que a linha mostra: nomes (com os avatares empilhados) ou só a contagem. */
export type CheeredByView =
  | { kind: 'names'; total: number; avatars: CheeredByUser[]; names: CheeredByUser[]; others: number }
  | { kind: 'count'; total: number };

type WithCheers = { cheers: number; cheeredBy?: CheeredBy | null };

/**
 * A linha «Brindado por…» de uma publicação, ou null sem brindes. `total` é o `cheers` da publicação (muda logo quando
 * brindo); as pessoas vêm do servidor (nunca eu: «outras N pessoas» conta também o meu brinde, como no Instagram).
 * Um nome e «outras N pessoas»; dois nomes só quando são exatamente os dois brindes.
 */
export function cheeredByView(p: WithCheers): CheeredByView | null {
  const users = Array.isArray(p.cheeredBy?.users) ? p.cheeredBy!.users.filter((u) => u && typeof u.username === 'string') : [];
  const total = Math.max(0, Math.floor(p.cheers ?? 0), users.length);
  if (!total) return null;
  if (!users.length) return { kind: 'count', total };
  const names = total === 2 && users.length >= 2 ? users.slice(0, 2) : users.slice(0, 1);
  return { kind: 'names', total, avatars: users.slice(0, 3), names, others: Math.max(0, total - names.length) };
}

/** «outra pessoa» / «outras 23 pessoas» (`fmt` escreve o número: 1,2 mil…). */
export function othersLabel(n: number, fmt: (n: number) => string = String): string {
  return n === 1 ? t('outra pessoa') : t('outras {fmt} pessoas', { fmt: fmt(n) });
}

/** Para o leitor de ecrã: «Brindado por @ana e outras 23 pessoas. Ver quem brindou». */
export function cheeredByA11y(v: CheeredByView, fmt: (n: number) => string = String): string {
  if (v.kind === 'count') return `${fmt(v.total)} ${v.total === 1 ? t('brinde') : t('brindes')}`;
  const names = v.names.map((u) => `@${u.username}`);
  const tail = v.others > 0 ? ` e ${othersLabel(v.others, fmt)}` : '';
  return t('Brindado por {value}{tail}', { value: names.length === 2 && !tail ? `${names[0]} e ${names[1]}` : names.join(', '), tail });
}

/** Os amigos próximos que brindaram (até 3). Nada se o dono não deixa ver. */
export function closeCheerers(p: { cheeredBy?: CheeredBy | null }, max = 3): CheeredByUser[] {
  const users = Array.isArray(p.cheeredBy?.users) ? p.cheeredBy!.users : [];
  return users.filter((u) => u && u.close === true && typeof u.username === 'string').slice(0, max);
}

/**
 * Quem flutua sobre a foto ou o vídeo (até 3): os amigos próximos que brindaram; se nenhum brindou, as pessoas que sigo
 * que brindaram. `kind` diz qual dos dois (para o leitor de ecrã). Vazio se nenhum, ou se o dono não deixa ver.
 */
export function floatingCheerers(p: { cheeredBy?: CheeredBy | null }, max = 3): { kind: 'close' | 'following'; users: CheeredByUser[] } {
  const close = closeCheerers(p, max);
  if (close.length) return { kind: 'close', users: close };
  const users = Array.isArray(p.cheeredBy?.users) ? p.cheeredBy!.users : [];
  return { kind: 'following', users: users.filter((u) => u && u.following === true && typeof u.username === 'string').slice(0, max) };
}
