/**
 * Administradores de um TxillGroup (lógica pura, sem React nem rede: testada em tests/groupRoles.test.mjs).
 * Só um administrador mexe nos papéis: torna alguém administrador, retira-lho, ou deixa ele próprio de o ser.
 * O grupo precisa sempre de pelo menos um administrador (o servidor responde 409 se o último se tentar retirar).
 */
export type GroupRole = 'admin' | 'member';
export type MemberActionId = 'promote' | 'demote' | 'step_down' | 'remove';
export interface MemberAction { id: MemberActionId; label: string; destructive?: boolean; role?: GroupRole }

export const LAST_ADMIN_MESSAGE = 'O grupo precisa de pelo menos um administrador';

/** Quantos administradores tem o grupo. */
export const adminCount = (members: { role?: GroupRole | null }[]): number => members.filter((m) => m.role === 'admin').length;

/** O selo junto ao nome. */
export const roleBadge = (role: GroupRole | null | undefined): string | null => (role === 'admin' ? 'Administrador' : null);

/**
 * As ações que eu vejo no menu de um membro. Só administradores têm ações; na minha linha só aparece "Deixar de ser administrador".
 * `role` é o papel que o PATCH vai pôr.
 */
export function memberActions(o: { myRole: GroupRole | null | undefined; me: string | null | undefined; member: { username: string; role?: GroupRole | null } }): MemberAction[] {
  if (o.myRole !== 'admin') return [];
  const self = !!o.me && o.me.toLowerCase() === o.member.username.toLowerCase();
  if (self) return [{ id: 'step_down', label: 'Deixar de ser administrador', role: 'member' }];
  const out: MemberAction[] = o.member.role === 'admin'
    ? [{ id: 'demote', label: 'Retirar administrador', role: 'member' }]
    : [{ id: 'promote', label: 'Tornar administrador', role: 'admin' }];
  out.push({ id: 'remove', label: 'Tirar do TxillGroup', destructive: true });
  return out;
}

/** Aviso no menu: sou o único administrador e quero deixar de o ser (o servidor vai recusar). */
export function stepDownNote(admins: number): string | null {
  return admins <= 1 ? 'És o único administrador: torna outra pessoa administrador antes de deixares de o ser.' : null;
}

/** A lista de membros depois de mudar o papel de alguém (atualização otimista). */
export function withRole<M extends { username: string; role: GroupRole }>(members: M[], username: string, role: GroupRole): M[] {
  const u = username.toLowerCase();
  return members.map((m) => (m.username.toLowerCase() === u ? { ...m, role } : m));
}

/** O que se diz ao terminar (leitor de ecrã e linha de estado). */
export function roleDoneText(action: MemberActionId, name: string): string {
  switch (action) {
    case 'promote': return `${name} agora é administrador.`;
    case 'demote': return `${name} deixou de ser administrador.`;
    case 'step_down': return 'Deixaste de ser administrador.';
    case 'remove': return `${name} saiu do TxillGroup.`;
  }
}
