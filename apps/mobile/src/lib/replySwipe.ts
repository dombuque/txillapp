/**
 * Deslizar uma bolha para a direita para lhe responder (como no WhatsApp/Instagram): a lógica pura, partilhada pela app
 * (react-native-gesture-handler) e pela web (toques do DOM), e testada em tests/replySwipe.test.mjs.
 * As funções marcadas com 'worklet' correm também na thread da interface (reanimated).
 */

/** Quantos pt para a direita até o gesto ser da bolha (antes disso um toque continua a ser um toque). O mesmo das linhas com swipe. */
export const REPLY_START_X = 14;
/** Se o dedo andar estes pt na vertical antes, é rolar a lista e a bolha desiste (8 = o "touch slop" do ScrollView do Android). */
export const REPLY_FAIL_Y = 8;
/** Para a esquerda, a bolha desiste logo (não há nada desse lado). */
export const REPLY_FAIL_X = 10;
/** Um gesto que nasce nos primeiros pt da borda esquerda é do sistema (voltar do iPhone): a bolha não mexe. */
export const REPLY_EDGE = 24;
/** Até onde a bolha vai, por mais que o dedo ande. */
export const REPLY_MAX = 72;
/** A partir de onde (deslocação da bolha) largar responde. */
export const REPLY_TRIGGER = 56;
/** Até aqui a bolha segue o dedo à letra; daí até REPLY_MAX custa cada vez mais. */
const KNEE = 40;
/** Web: depois de quantos px se decide se o gesto é para o lado (bolha) ou para cima/baixo (rolar). */
export const REPLY_LOCK_PX = 10;
/** Web: para ser da bolha, |dx| tem de ser pelo menos 1,5 vezes |dy| (o mesmo das linhas com swipe). */
export const REPLY_LOCK_RATIO = 1.5;
/** Tamanho do círculo do ícone de responder. */
export const REPLY_ICON = 32;

/**
 * Onde fica a bolha para um dedo que andou `dx` para a direita (já descontado o arranque): segue o dedo até KNEE e depois
 * aproxima-se de REPLY_MAX sem nunca o passar (resistência). Para a esquerda não sai do sítio.
 */
export function replyPull(dx: number): number {
  'worklet';
  if (!(dx > 0)) return 0;
  if (dx <= KNEE) return dx;
  const room = REPLY_MAX - KNEE;
  return KNEE + room * (1 - Math.exp(-(dx - KNEE) / room));
}

/** Passou o limiar: largar aqui responde (e o ícone fica cheio). */
export function replyArmed(x: number): boolean {
  'worklet';
  return x >= REPLY_TRIGGER;
}

/** 0..1: quanto falta para o limiar (para o ícone ir aparecendo). */
export function replyProgress(x: number): number {
  'worklet';
  return Math.min(1, Math.max(0, x / REPLY_TRIGGER));
}

/** O gesto nasceu na borda esquerda do ecrã (o voltar do sistema). */
export function fromLeftEdge(x0: number): boolean {
  'worklet';
  return x0 < REPLY_EDGE;
}

/**
 * Web: o que é este gesto ao fim de uns px (`cancelable` = o browser ainda não começou a rolar):
 * - `wait`: ainda não andou o bastante para se saber;
 * - `reply`: claramente para a direita, é da bolha;
 * - `off`: rolar, para a esquerda ou já a rolar: fica com o browser (e a seleção de texto).
 */
export function replyLock(dx: number, dy: number, cancelable = true): 'wait' | 'reply' | 'off' {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < REPLY_LOCK_PX) return 'wait';
  if (!cancelable || dx <= 0 || Math.abs(dx) <= Math.abs(dy) * REPLY_LOCK_RATIO) return 'off';
  return 'reply';
}

/**
 * As mensagens que se podem deslizar para responder: já enviadas (não a enviar nem falhadas), não apagadas e não de sistema
 * (chamadas). O vídeo dentro da bolha também não: tem a barra do leitor, que se arrasta para o lado (responde-se pelo menu).
 */
export function canSwipeReply(m: { id: string; kind: string; state?: string; deleted?: boolean; deletedAt?: string | null; viewOnce?: boolean; mediaUrl?: string | null }): boolean {
  if (m.id.startsWith('tmp-') || m.state) return false;
  if (m.deleted || m.deletedAt) return false;
  if (m.kind === 'video' && !m.viewOnce && m.mediaUrl) return false;
  return m.kind !== 'call' && m.kind !== 'system';
}
