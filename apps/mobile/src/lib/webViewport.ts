/**
 * A altura de referência da janela na web para saber se o teclado está aberto (sem React; testada em
 * tests/chatKeyboard.test.mjs e tests/sheetViewport.test.mjs). Quem a lê da janela é `webWindowH` em
 * components/zas/useVisibleViewport; usam-na as conversas (components/ChatScreen), as folhas (components/Sheet,
 * lib/sheetViewport), os mimos, os Zás e a Txillada (lib/keyboardFrame `webKeyboardBox`).
 *
 * É a maior entre `innerHeight` e a altura do documento (`documentElement.clientHeight`): se o `innerHeight` também
 * encolher com o teclado (há versões do iPhone em que encolhe), o teclado continua a ser visto. O zoom (página
 * ampliada) não conta como teclado: isso é com cada conta (`scale` e a largura da zona visível).
 */
export function webWindowHeight(innerHeight: number, clientHeight: number): number {
  return Math.max(innerHeight || 0, clientHeight || 0);
}
