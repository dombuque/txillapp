// Os brindes à geleira: os textos da contagem e dos botões e a atualização otimista do nível.
// Sem dependências (os testes correm em Node: tests/geleiraCheers.test.mjs).

/** `cheersListable`: posso ver quem brindou (o dono sempre; os outros se o dono mostra a lista). */
export interface CheerState { cheers?: number; cheered?: boolean; cheersListable?: boolean }

/** Número inteiro e não negativo (o servidor pode mandar lixo; nunca mostrar "-1 brindes"). */
const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** "1 brinde", "12 brindes" (0 → "0 brindes"). */
export function cheersCount(n: unknown): string {
  const k = count(n);
  return `${k} ${k === 1 ? 'brinde' : 'brindes'}`;
}

/**
 * O texto do botão do visitante: "Brindar" ou, já brindado, "Brindaste", com a contagem a seguir ("Brindar · 12").
 * Se a lista de quem brindou está à vista (`listed`), a contagem vai no botão ao lado ("12 brindes") e aqui não se repete.
 */
export function cheerButtonText(n: unknown, cheered = false, listed = false): string {
  const k = count(n);
  const verb = cheered ? 'Brindaste' : 'Brindar';
  return k === 0 || listed ? verb : `${verb} · ${k}`;
}

/** Posso abrir a lista de quem brindou? O dono sempre; o visitante só se o servidor disser `cheersListable`. */
export function canListCheers(level: CheerState | null | undefined, isMe: boolean): boolean {
  if (!canCheer(level)) return false;
  return isMe || level?.cheersListable === true;
}

/** O título da folha de quem brindou: a minha ou a de outra pessoa. */
export function cheerersTitle(isMe: boolean, name: string): string {
  const who = name.trim();
  return isMe ? 'Quem brindou a tua geleira' : who ? `Quem brindou a geleira de ${who}` : 'Quem brindou a geleira';
}

/** O número no selo do botão da geleira (perfil): vazio sem brindes, "99+" acima de 99. */
export function cheersBadge(n: unknown): string {
  const k = count(n);
  return k === 0 ? '' : k > 99 ? '99+' : String(k);
}

/** O que o leitor de ecrã diz no botão que abre/fecha a geleira no perfil, com os brindes se houver. */
export function geleiraToggleLabel(open: boolean, n: unknown): string {
  const base = open ? 'Fechar a geleira' : 'Abrir a geleira';
  return count(n) === 0 ? base : `${base}, ${cheersCount(n)}`;
}

/** O que o leitor de ecrã diz no botão do visitante (a contagem vai à parte, em `accessibilityValue`). */
export function cheerA11yLabel(cheered: boolean, name: string): string {
  if (cheered) return 'Tirar o brinde';
  const who = name.trim();
  return `Brindar a geleira${who ? ` de ${who}` : ''}`;
}

/** O que o leitor de ecrã diz na contagem que abre a lista de quem brindou (dono, ou visitante com a lista à vista). */
export function ownerCheersA11yLabel(n: unknown): string {
  return `${cheersCount(n)}, ver quem brindou`;
}

/** O servidor sabe de brindes? (Servidor antigo não manda `cheers` → não há botão.) */
export function canCheer(level: CheerState | null | undefined): boolean {
  return !!level && typeof level.cheers === 'number' && Number.isFinite(level.cheers);
}

/** Atualização otimista: alterna o brinde e acerta a contagem (nunca abaixo de 0). Devolve um objeto novo. */
export function toggleCheer<T extends CheerState>(level: T): T {
  const was = !!level.cheered;
  const n = count(level.cheers);
  return { ...level, cheered: !was, cheers: was ? Math.max(0, n - 1) : n + 1 };
}

/** Junta a resposta do servidor (`{ cheered, cheers }`) ao nível guardado. */
export function applyCheer<T extends CheerState>(level: T, r: { cheered: boolean; cheers: number }): T {
  return { ...level, cheered: !!r.cheered, cheers: count(r.cheers) };
}
