/**
 * O teclado nas conversas, sem React (testado em tests/chatKeyboard.test.mjs). Quem usa: components/ChatScreen.
 *
 * - Com o teclado aberto, a barra de escrever fica colada a ele: a margem de baixo do sistema (a linha do iPhone, a
 *   barra de navegação do Android, os 21,6 px do PWA) fica por baixo do teclado e deixava um vão branco por cima dele.
 * - No Safari do iPhone (PWA) o teclado não encolhe a página: tapa-a e o Safari arrasta a página para cima (o cabeçalho
 *   saía do ecrã). Com o teclado aberto a conversa passa a ocupar só a zona visível (`visualViewport`), como o visor dos
 *   mimos (app/stories). No Android (Chrome) a página encolhe sozinha (interactive-widget=resizes-content): nada a fazer.
 */

/** Na web, o teclado está aberto quando a zona visível é bem mais baixa do que a janela (a barra do Safari não chega). */
export const KEYBOARD_MIN_PX = 120;

export function webKeyboardOpen(visibleHeight: number, windowHeight: number): boolean {
  return visibleHeight > 0 && windowHeight > 0 && visibleHeight < windowHeight - KEYBOARD_MIN_PX;
}

/** A margem de baixo da barra de escrever: a do sistema, ou nenhuma com o teclado aberto (fica por baixo dele). */
export function composerInset(bottom: number, keyboardOpen: boolean): number {
  return keyboardOpen ? 0 : bottom;
}
