// A nota da outra pessoa no cabeçalho da conversa 1:1 (como o recado do WhatsApp por baixo da foto): quando o balão
// aparece, quando encolhe de volta para a foto, e o que diz. Sem dependências (os testes correm em Node:
// tests/chatPeerNote.test.mjs).

/** Quanto se sobe nas mensagens (pt) até o balão encolher. */
export const NOTE_FOLD_SCROLL = 80;
/** Ao fim de quanto tempo à vista (ms) o balão encolhe sozinho. */
export const NOTE_FOLD_MS = 8000;

export interface PeerNoteLike {
  body: string;
  music?: { title: string } | null;
  createdAt: string;
  expiresAt: string;
}

/** A nota ainda vale (as notas duram 24 horas; uma conversa aberta muito tempo não mostra uma nota já acabada). */
export function activePeerNote<N extends PeerNoteLike>(note: N | null | undefined, now = Date.now()): N | null {
  if (!note) return null;
  const end = Date.parse(note.expiresAt);
  if (Number.isFinite(end) && end <= now) return null;
  if (!note.body.trim() && !note.music?.title) return null;
  return note;
}

/** Identifica a nota (uma nota nova da mesma pessoa volta a abrir o balão). */
export const peerNoteKey = (note: PeerNoteLike | null | undefined) => (note ? `${note.createdAt}|${note.body}` : null);

/** O que o balão mostra: o texto e, se tiver música, "♪ título" (sozinho, se a nota for só a música). */
export function peerNoteLines(note: PeerNoteLike) {
  const text = note.body.trim();
  const title = note.music?.title?.trim() ?? '';
  return { text, track: title ? `♪ ${title}` : '' };
}

/** O que o leitor de ecrã diz do balão: "Nota de Ana: Bora txilar. Abrir". */
export function peerNoteLabel(name: string, note: PeerNoteLike) {
  const { text } = peerNoteLines(note);
  const title = note.music?.title?.trim() ?? '';
  const said = [text, title ? `música ${title}` : ''].filter(Boolean).join(', ');
  return `Nota de ${name}: ${said}. Abrir`;
}

/**
 * Estado do balão: `open` = à vista; fechado = encolhido na foto (fica o ponto). `anchorY` = onde estava a lista quando
 * abriu (ou o ponto mais em baixo desde então); `seq` muda a cada abertura (para o relógio dos 8 s recomeçar).
 */
export interface NoteFold { key: string | null; open: boolean; anchorY: number; seq: number }

export type NoteFoldEvent =
  /** Chegou (ou mudou) a nota; `key` null = deixou de haver nota. `y` = onde está a lista agora. */
  | { type: 'note'; key: string | null; y: number }
  /** A lista deslizou (lista invertida: `y` cresce quando se sobe para as mensagens mais antigas). */
  | { type: 'scroll'; y: number }
  /** Passaram os 8 s. */
  | { type: 'timeout' }
  /** Tocou na foto ou no ponto: volta a mostrar. */
  | { type: 'show'; y: number };

export const NOTE_FOLD_START: NoteFold = { key: null, open: false, anchorY: 0, seq: 0 };

export function noteFold(s: NoteFold, e: NoteFoldEvent): NoteFold {
  switch (e.type) {
    case 'note':
      if (!e.key) return s.key === null ? s : { ...NOTE_FOLD_START, seq: s.seq };
      if (e.key === s.key) return s;
      return { key: e.key, open: true, anchorY: e.y, seq: s.seq + 1 };
    case 'scroll': {
      if (!s.open) return s;
      if (e.y - s.anchorY > NOTE_FOLD_SCROLL) return { ...s, open: false };
      // Descer outra vez conta a partir do ponto mais em baixo.
      return e.y < s.anchorY ? { ...s, anchorY: e.y } : s;
    }
    case 'timeout':
      return s.open ? { ...s, open: false } : s;
    case 'show':
      return s.key ? { ...s, open: true, anchorY: e.y, seq: s.seq + 1 } : s;
  }
}
