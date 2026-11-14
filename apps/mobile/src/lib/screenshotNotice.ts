// Capturas de ecrã: a lógica pura (sem React nem módulos nativos; os testes em tests/screenshotNotice.test.mjs
// importam este ficheiro diretamente). O que fala com o expo-screen-capture está em src/lib/screenCapture.ts.
//
// Contrato da API:
// - POST /chat/with/:username/screenshot e POST /chat/groups/:id/screenshot: fiz uma captura nesta conversa. O servidor
//   deixa na conversa um aviso de sistema (kind 'system', system: { type: 'screenshot', name }) com o texto já para
//   quem o vê em `body` («Fulano fez uma captura de ecrã.» ou «Fizeste uma captura de ecrã.»).
// - POST /instants/:id/screenshot: fiz uma captura do Zás de outra pessoa (só no iPhone, ou no Android 14+ quando o
//   sistema avisa; no Android o Zás dos outros tem FLAG_SECURE e a captura nem chega a sair).
// O anti-spam a sério é da API; a app não manda mais de um pedido a cada 5 s pela mesma conversa (ou pelo mesmo Zás).

/** O intervalo mínimo entre dois avisos da mesma conversa (ou do mesmo Zás). */
export const SCREENSHOT_GAP_MS = 5_000;

/**
 * Pode mandar-se já o aviso desta `key` («u:fulano», «g:id», «zas:id»)? Se sim, fica marcado em `last` com `now`.
 * Dentro dos 5 s seguintes à última vez, não. Um relógio que andou para trás conta como passado o tempo.
 */
export function takeScreenshotSlot(last: Map<string, number>, key: string, now: number, gap: number = SCREENSHOT_GAP_MS): boolean {
  const prev = last.get(key);
  if (prev !== undefined && now >= prev && now - prev < gap) return false;
  last.set(key, now);
  return true;
}

/** As chaves de cada sítio (uma conversa a dois, um TxillGroup, um Zás). */
export const screenshotKey = {
  direct: (username: string) => `u:${username.toLowerCase()}`,
  group: (id: string) => `g:${id}`,
  zas: (id: string) => `zas:${id}`,
};

/** O que vem em `system` de um aviso (o tipo diz o que foi; o servidor manda o texto em `body`). */
export type SystemInfo = { type: 'ttl'; ttl: number | null } | { type: 'screenshot'; name: string } | { type?: string } | null | undefined;

/** O aviso é o de uma captura de ecrã. */
export const isScreenshotNotice = (m: { kind?: string; system?: SystemInfo }) => m.kind === 'system' && m.system?.type === 'screenshot';

/** O ícone do aviso ao centro da conversa: uma câmara para as capturas, o relógio para as mensagens temporárias. */
export function systemIcon(m: { system?: SystemInfo }): 'camera' | 'clock' {
  return m.system?.type === 'screenshot' ? 'camera' : 'clock';
}

/**
 * O texto do aviso: o que o servidor manda em `body`. Sem ele (servidor antigo ou aviso incompleto), uma captura
 * escreve-se aqui: «Fizeste uma captura de ecrã.» (minha) ou «Fulano fez uma captura de ecrã.».
 */
export function systemText(m: { body?: string | null; fromMe?: boolean; system?: SystemInfo }): string {
  const body = (m.body ?? '').trim();
  if (body) return body;
  const s = m.system;
  if (s?.type === 'screenshot') {
    if (m.fromMe) return 'Fizeste uma captura de ecrã.';
    const name = 'name' in s && typeof s.name === 'string' ? s.name.trim() : '';
    return `${name || 'Alguém'} fez uma captura de ecrã.`;
  }
  return '';
}
