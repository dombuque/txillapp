/**
 * A Txillada fora do ecrã dela (lib/txilladaSession, components/txillada/TxilladaMini): quem vê sai para outro sítio da app
 * (sem tocar em Sair) e a Txillada continua ligada, com o som, num leitor pequeno que se arrasta; o anfitrião continua ao
 * vivo, com a pílula «Estás ao vivo · Voltar». Se a app instalada (PWA) recarregar ao voltar (register-sw), fica lembrada a
 * Txillada aberta (como lib/createKeep) e oferece-se voltar a ela.
 *
 * Contas puras (sem React nem armazenamento), testadas em tests/txilladaMini.test.mjs.
 */

/** A Txillada aberta fica lembrada este tempo depois da última vez que se viu ligada (renova-se de minuto a minuto). */
export const OPEN_KEEP_MS = 30 * 60_000;
export const OPEN_KEY = 'tx_txillada_open';
/** De quanto em quanto tempo se renova a lembrança enquanto está ligada. */
export const OPEN_REFRESH_MS = 60_000;

export type OpenTxillada = { id: string; host: string; hostName: string; isHost: boolean };

export function encodeOpen(o: OpenTxillada, now: number): string {
  return JSON.stringify({ v: o, at: now });
}

/** A Txillada lembrada, se ainda vale (nem velha demais, nem do futuro); senão null. */
export function decodeOpen(raw: string | null | undefined, now: number): OpenTxillada | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { v?: Partial<OpenTxillada>; at?: unknown };
    if (!o || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
    if (now - o.at > OPEN_KEEP_MS || o.at - now > 60_000) return null;
    const v = o.v;
    if (!v || typeof v.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(v.id) || typeof v.host !== 'string' || !v.host) return null;
    return { id: v.id, host: v.host.slice(0, 40), hostName: typeof v.hostName === 'string' ? v.hostName.slice(0, 80) : v.host.slice(0, 40), isHost: v.isHost === true };
  } catch {
    return null;
  }
}

/** Estou no ecrã desta Txillada? (o endereço `/txillada/<id>`, com ou sem a barra no fim e os parâmetros). */
export function onTxilladaScreen(pathname: string | null | undefined, id: string): boolean {
  if (!pathname || !id) return false;
  const p = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  return p === `/txillada/${id}` || p === `/txillada/${encodeURIComponent(id)}`;
}

export type MiniMode = 'none' | 'video' | 'host' | 'ended' | 'connecting';

/**
 * O que mostrar fora do ecrã: nada no ecrã da própria Txillada (ou a carregar); o anfitrião (e quem transmite como
 * convidado) vê a pílula; quem vê, o leitor com o vídeo; acabada, a pílula «A Txillada acabou».
 */
export function miniMode(o: { onScreen: boolean; kind: string; host: boolean; onStage: boolean }): MiniMode {
  if (o.onScreen) return 'none';
  if (o.kind === 'ended') return 'ended';
  if (o.kind === 'loading') return 'connecting';
  if (o.kind !== 'live') return 'none';
  return o.host || o.onStage ? 'host' : 'video';
}

/** O texto da pílula (o anfitrião, quem transmite e a Txillada acabada). */
export function miniPillText(mode: MiniMode, o: { host: boolean; hostUsername: string }): string {
  if (mode === 'ended') return o.host ? 'A tua Txillada acabou · Ver o resumo' : 'A Txillada acabou';
  if (mode === 'host') return o.host ? 'Estás ao vivo · Voltar' : 'Estás a transmitir · Voltar';
  if (mode === 'connecting') return `A ligar à Txillada de @${o.hostUsername}`;
  return `Ao vivo · @${o.hostUsername} · Voltar`;
}

export type Box = { w: number; h: number };
export type Pos = { x: number; y: number };

/** O leitor pequeno: 9:16, um terço da largura (entre 96 e 150 px). */
export function miniSize(screen: Box): Box {
  const w = Math.round(Math.max(96, Math.min(150, screen.w * 0.3)));
  return { w, h: Math.round((w * 16) / 9) };
}

/**
 * Onde o leitor fica ao largar: encostado ao lado mais perto (esquerda ou direita), dentro do ecrã, entre o topo seguro e
 * a barra de baixo (os separadores). `margin` à volta.
 */
export function miniSnap(pos: Pos, size: Box, screen: Box, safe: { top: number; bottom: number }, margin = 12): Pos {
  const left = margin;
  const right = Math.max(margin, screen.w - size.w - margin);
  const x = pos.x + size.w / 2 < screen.w / 2 ? left : right;
  const minY = safe.top + margin;
  const maxY = Math.max(minY, screen.h - safe.bottom - size.h - margin);
  const y = Math.min(maxY, Math.max(minY, pos.y));
  return { x, y };
}

/** Onde o leitor começa: em baixo à direita, por cima da barra dos separadores. */
export function miniStart(size: Box, screen: Box, safe: { top: number; bottom: number }, margin = 12): Pos {
  return miniSnap({ x: screen.w, y: screen.h }, size, screen, safe, margin);
}

/** Um toque e não um arrasto (o leitor abre a Txillada; arrastar só o muda de sítio). */
export const isTap = (dx: number, dy: number, ms: number) => Math.abs(dx) < 8 && Math.abs(dy) < 8 && ms < 450;
