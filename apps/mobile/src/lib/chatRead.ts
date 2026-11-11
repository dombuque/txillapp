/**
 * A conversa está mesmo à vista? Só assim o pedido das mensagens pode marcar como lidas.
 * Ecrã em primeiro plano na navegação, app ativa e, no browser, a janela com o foco (com outra janela por cima, ou
 * noutro separador, não se lê nada). Testado em tests/chatRead.test.mjs.
 */
export function canMarkRead(s: { focused: boolean; appState: string; web: boolean; hasFocus: boolean }): boolean {
  return s.focused && s.appState === 'active' && (!s.web || s.hasFocus);
}
