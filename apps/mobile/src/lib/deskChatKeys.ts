/**
 * Mensagens no computador (rato e teclado): o que cada tecla faz, sem dependências (os testes correm em Node:
 * tests/deskChat.test.mjs). Quem liga isto aos ecrãs é lib/deskChat (useDeskChat) e só no computador: no telemóvel e no
 * PWA do telemóvel nada disto corre.
 */

export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** A escrever com um método de entrada (acentos compostos, chinês…): o Enter é dele, não envia. */
  isComposing?: boolean;
  keyCode?: number;
}

const composing = (e: KeyLike) => !!e.isComposing || e.keyCode === 229;
const anyMod = (e: KeyLike) => !!(e.shiftKey || e.ctrlKey || e.metaKey || e.altKey);

/**
 * A caixa de escrever da conversa:
 * - Enter envia; Shift+Enter (e Ctrl/Alt+Enter) mudam de linha, como o browser faz;
 * - Esc cancela (a resposta, os stickers, o menu "+");
 * - ↑ com a caixa vazia edita a minha última mensagem, se ainda der para editar.
 */
export type ComposerKey = 'send' | 'cancel' | 'edit-last' | null;
export function composerKey(e: KeyLike, ctx: { text: string; canEditLast: boolean }): ComposerKey {
  if (composing(e)) return null;
  if (e.key === 'Enter') return anyMod(e) ? null : 'send';
  if (e.key === 'Escape') return 'cancel';
  if (e.key === 'ArrowUp' && !anyMod(e) && ctx.text === '' && ctx.canEditLast) return 'edit-last';
  return null;
}

/** A barra de editar uma mensagem: Enter grava, Shift+Enter muda de linha, Esc cancela a edição. */
export type EditKey = 'save' | 'cancel' | null;
export function editBarKey(e: KeyLike): EditKey {
  if (composing(e)) return null;
  if (e.key === 'Enter') return anyMod(e) ? null : 'save';
  if (e.key === 'Escape') return 'cancel';
  return null;
}

/**
 * Atalhos da lista de conversas (em qualquer sítio das Mensagens):
 * - Ctrl+K (⌘K no Mac) procura conversas;
 * - Alt+↑ / Alt+↓ passa à conversa anterior / seguinte da lista;
 * - "?" mostra a ajuda dos atalhos (só fora das caixas de texto: lá é um "?" escrito).
 * O Esc da caixa de procurar é dela (sai da pesquisa).
 */
export type InboxShortcut = 'search' | 'prev' | 'next' | 'help' | null;
export function inboxShortcut(e: KeyLike, ctx: { typing: boolean }): InboxShortcut {
  if (composing(e)) return null;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') return 'search';
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (e.key === 'ArrowUp') return 'prev';
    if (e.key === 'ArrowDown') return 'next';
  }
  if (e.key === '?' && !ctx.typing && !e.ctrlKey && !e.metaKey && !e.altKey) return 'help';
  return null;
}

/**
 * A conversa anterior/seguinte na lista (os endereços pela ordem em que aparecem). Sem conversa aberta (ou uma que não
 * está na lista), ↓ vai à primeira e ↑ à última. Nas pontas não dá a volta: fica onde está (null).
 */
export function neighbourChat(paths: string[], current: string | null, dir: 1 | -1): string | null {
  if (!paths.length) return null;
  const i = current ? paths.indexOf(current) : -1;
  if (i < 0) return dir === 1 ? paths[0] : paths[paths.length - 1];
  const j = i + dir;
  return j >= 0 && j < paths.length ? paths[j] : null;
}

/** A conversa aberta, pelo endereço (/messages/ana, /messages/g/123), ou null na lista sozinha e em "Nova mensagem". */
export function openChatPath(pathname: string): string | null {
  const m = /^\/messages\/(g\/[^/]+|[^/]+)$/.exec(pathname);
  if (!m || m[1] === 'new') return null;
  return `/messages/${m[1]}`;
}

/** A minha última mensagem já enviada (a lista vem da mais recente para a mais antiga; avisos de sistema não contam). */
export function lastMine<T extends { id: string; fromMe: boolean; kind: string; state?: string }>(items: T[]): T | null {
  return items.find((m) => m.fromMe && m.kind !== 'system' && !m.state && !m.id.startsWith('tmp-')) ?? null;
}

/** A ajuda dos atalhos ("?"): as teclas e o que fazem. `mac` troca Ctrl por ⌘. */
export function shortcutHelp(mac: boolean): { keys: string[]; label: string }[] {
  const mod = mac ? '⌘' : 'Ctrl';
  return [
    { keys: [mod, 'K'], label: 'Procurar conversas' },
    { keys: ['Alt', '↑'], label: 'Conversa anterior' },
    { keys: ['Alt', '↓'], label: 'Conversa seguinte' },
    { keys: ['Enter'], label: 'Enviar a mensagem' },
    { keys: ['Shift', 'Enter'], label: 'Mudar de linha' },
    { keys: ['↑'], label: 'Editar a tua última mensagem (com a caixa vazia)' },
    { keys: ['Esc'], label: 'Fechar, cancelar a resposta ou a edição, sair da pesquisa' },
    { keys: ['?'], label: 'Mostrar estes atalhos' },
  ];
}

/** Arrastar para a conversa: só ficheiros contam (texto ou ligações arrastados ficam com o browser). */
export function dragHasFiles(types: readonly string[] | null | undefined): boolean {
  return !!types && Array.from(types).includes('Files');
}

/** Contador de dragenter/dragleave: a zona de largar só desaparece quando o rato sai de vez (os filhos também mandam eventos). */
export function dragDepth(depth: number, ev: 'enter' | 'leave' | 'drop'): number {
  if (ev === 'drop') return 0;
  return Math.max(0, depth + (ev === 'enter' ? 1 : -1));
}

/** O menu de contexto (botão direito ou "⋯") cabe na janela: encosta-se para dentro se passar das bordas. */
export function menuPosition(at: { x: number; y: number }, size: { w: number; h: number }, win: { w: number; h: number }, margin = 8): { left: number; top: number } {
  const left = Math.max(margin, Math.min(at.x, win.w - size.w - margin));
  const top = at.y + size.h + margin > win.h ? Math.max(margin, at.y - size.h) : at.y;
  return { left, top: Math.max(margin, Math.min(top, win.h - size.h - margin)) };
}
