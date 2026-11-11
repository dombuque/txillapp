/**
 * O menu de uma mensagem (carregar e segurar a bolha), como no WhatsApp: a lógica pura, testada em tests/messageMenu.test.mjs.
 * - que opções aparecem (reagir, responder, copiar, apagar para mim/para todos, denunciar) consoante a mensagem é minha ou
 *   da outra pessoa, o tempo desde que foi enviada e o tipo;
 * - o que muda logo na conversa ao apagar (antes de o servidor responder);
 * - o carregar e segurar da web (o tempo e quanto o dedo pode tremer) e as ações do leitor de ecrã.
 */

/**
 * Até quando (ms depois de enviar) se pode apagar para todos. `null` = sem limite, que é a regra do servidor
 * (apps/api chat.service `remove`: só quem enviou, a qualquer altura). Se o servidor passar a ter limite, muda-se aqui.
 */
export const DELETE_FOR_ALL_LIMIT_MS: number | null = null;

/** Até quando (ms depois de enviar) se edita uma mensagem de texto. O servidor tem o mesmo (chat.service EDIT_WINDOW_MS). */
export const EDIT_WINDOW_MS = 15 * 60_000;

/** Quanto tempo se segura a bolha até abrir o menu (o mesmo no telemóvel e na web). */
export const HOLD_MS = 420;
/** Se o dedo andar mais do que isto (px) enquanto segura, não é segurar (é rolar ou deslizar). O mesmo do Pressable. */
export const HOLD_SLOP = 10;

/** O aviso que fica no lugar de uma mensagem apagada para todos (o servidor manda o mesmo texto). */
export const deletedText = (mine: boolean) => (mine ? 'Apagaste esta mensagem' : 'Esta mensagem foi apagada');

export type MenuMsg = {
  id: string;
  fromMe: boolean;
  kind: string;
  body?: string;
  at: string;
  state?: string;
  deleted?: boolean;
  viewOnce?: boolean;
};

export interface MessageOptions {
  react: boolean;
  reply: boolean;
  copy: boolean;
  /** "Editar": só as minhas de texto, nos primeiros 15 minutos. */
  edit: boolean;
  /** "Apagar para mim": qualquer mensagem já enviada (minha ou da outra pessoa, também o aviso de uma apagada). */
  deleteForMe: boolean;
  /** "Apagar para todos": só as minhas, não apagadas, dentro do limite de tempo (se houver). */
  deleteForAll: boolean;
  report: boolean;
}

/** Já está no servidor (não é a que está a enviar nem a que falhou). */
export const isSent = (m: Pick<MenuMsg, 'id' | 'state'>) => !m.id.startsWith('tmp-') && !m.state;

/** Mensagens de sistema (o registo de uma chamada): não se responde nem se denuncia. */
const SYSTEM = new Set(['call', 'system']);
/** Tipos com texto que se pode copiar (a foto, só a legenda). */
const COPYABLE = new Set(['text', 'story_reply', 'zas_reply', 'image']);

export function canDeleteForAll(m: MenuMsg, now = Date.now(), limitMs: number | null = DELETE_FOR_ALL_LIMIT_MS): boolean {
  if (!isSent(m) || !m.fromMe || m.deleted) return false;
  if (limitMs == null) return true;
  const t = Date.parse(m.at);
  return Number.isFinite(t) && now - t <= limitMs;
}

/** Resposta a uma nota: o servidor escreve o texto com a nota à frente (não se edita, para não estragar a citação). */
const NOTE_REPLY = /^Em resposta à tua nota “[\s\S]*?”: ([\s\S]*)$/;

/** "Editar": a minha, de texto (não de visualização única nem resposta a uma nota), nos primeiros EDIT_WINDOW_MS. */
export function canEdit(m: MenuMsg, now = Date.now(), windowMs = EDIT_WINDOW_MS): boolean {
  if (!isSent(m) || !m.fromMe || m.deleted || m.viewOnce || m.kind !== 'text') return false;
  if (NOTE_REPLY.test(m.body ?? '')) return false;
  const t = Date.parse(m.at);
  return Number.isFinite(t) && now - t <= windowMs;
}

/** O texto a copiar (numa resposta a uma nota, só a resposta; sem nada, ''). */
export function copyText(m: Pick<MenuMsg, 'kind' | 'body'>): string {
  const body = m.body ?? '';
  const note = m.kind === 'text' ? NOTE_REPLY.exec(body) : null;
  return note ? note[1] : body;
}

export function messageOptions(m: MenuMsg, now = Date.now(), limitMs: number | null = DELETE_FOR_ALL_LIMIT_MS): MessageOptions {
  const none = { react: false, reply: false, copy: false, edit: false, deleteForMe: false, deleteForAll: false, report: false };
  if (!isSent(m)) return none;
  // Apagada para todos: só se pode tirar o aviso da minha conversa.
  if (m.deleted) return { ...none, deleteForMe: true };
  const system = SYSTEM.has(m.kind);
  return {
    react: true,
    reply: !system,
    copy: !m.viewOnce && COPYABLE.has(m.kind) && copyText(m).trim().length > 0,
    edit: canEdit(m, now),
    deleteForMe: true,
    deleteForAll: canDeleteForAll(m, now, limitMs),
    report: !m.fromMe && !system,
  };
}

export type DeleteMode = 'all' | 'me';

/** As escolhas da folha "Apagar mensagem?", pela ordem em que aparecem (o "Cancelar" vem sempre no fim). */
export function deleteChoices(o: Pick<MessageOptions, 'deleteForAll' | 'deleteForMe'>): DeleteMode[] {
  return [...(o.deleteForAll ? (['all'] as const) : []), ...(o.deleteForMe ? (['me'] as const) : [])];
}

type Item = { id: string; fromMe: boolean; replyTo?: unknown; [k: string]: unknown };

/**
 * A conversa logo depois de apagar (otimista; o refetch confirma):
 * - 'me': a mensagem sai da minha conversa;
 * - 'all': fica o aviso no lugar dela (sem nada do que tinha) e as respostas a ela passam a citar "Mensagem apagada".
 */
export function applyDeletion<T extends Item>(items: T[], id: string, mode: DeleteMode): T[] {
  if (mode === 'me') return items.filter((m) => m.id !== id);
  return items.map((m) => {
    if (m.id === id) {
      return {
        ...m,
        deleted: true,
        kind: 'text',
        body: deletedText(m.fromMe),
        viewOnce: false,
        opened: false,
        storyUrl: null,
        mediaUrl: null,
        durationMs: null,
        waveform: null,
        lat: null,
        lng: null,
        giftAmount: null,
        post: undefined,
        poll: undefined,
        live: false,
        liveUntil: null,
        replyTo: null,
        reactions: [],
      } as T;
    }
    const q = m.replyTo as { id?: string } | null | undefined;
    return q && q.id === id ? ({ ...m, replyTo: { id, gone: true } } as T) : m;
  });
}

/** O mesmo, nos dados de uma conversa do react-query (páginas com `items`). */
export function applyDeletionToPages<D>(data: D, id: string, mode: DeleteMode): D {
  const d = data as unknown as { pages?: { items?: Item[] }[] } | undefined;
  if (!d || !Array.isArray(d.pages)) return data;
  return { ...d, pages: d.pages.map((p) => (Array.isArray(p.items) ? { ...p, items: applyDeletion(p.items, id, mode) } : p)) } as unknown as D;
}

/** A conversa logo depois de editar (otimista): o texto novo e a marca "editada". */
export function applyEditToPages<D>(data: D, id: string, body: string): D {
  const d = data as unknown as { pages?: { items?: Item[] }[] } | undefined;
  if (!d || !Array.isArray(d.pages)) return data;
  const text = body.trim();
  return {
    ...d,
    pages: d.pages.map((p) => (Array.isArray(p.items) ? { ...p, items: p.items.map((m) => (m.id === id ? { ...m, body: text, edited: true } : m)) } : p)),
  } as unknown as D;
}

/** Segurar: o dedo ainda está dentro da folga (se sair, já não abre o menu). */
export const holdStill = (dx: number, dy: number) => Math.hypot(dx, dy) <= HOLD_SLOP;

/**
 * Depois de o menu abrir por um caminho (o onLongPress do Pressable, o temporizador da web ou o contextmenu), os outros
 * caminhos do mesmo toque não o abrem outra vez, e deslizar no mesmo toque já não responde.
 */
export const HOLD_DEDUP_MS = 1500;
export const recentlyHeld = (heldAt: number, now = Date.now()) => heldAt > 0 && now - heldAt < HOLD_DEDUP_MS;

/** As ações da bolha para o leitor de ecrã (o mesmo que deslizar e que segurar). Nomes livres, não são `accessibilityRole`. */
export function bubbleA11yActions(o: { reply: boolean; menu: boolean; remove: boolean }): { name: string; label: string }[] {
  return [
    ...(o.reply ? [{ name: 'reply', label: 'Responder' }] : []),
    ...(o.remove ? [{ name: 'delete', label: 'Apagar' }] : []),
    ...(o.menu ? [{ name: 'longpress', label: 'Mais opções' }] : []),
  ];
}
