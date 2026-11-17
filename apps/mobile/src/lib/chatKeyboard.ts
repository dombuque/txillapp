/**
 * O teclado nas conversas, sem React (testado em tests/chatKeyboard.test.mjs). Quem usa: components/ChatScreen.
 *
 * - Com o teclado aberto, a barra de escrever fica colada a ele: a margem de baixo do sistema (a linha do iPhone, a
 *   barra de navegação do Android, os 21,6 px do PWA) fica por baixo do teclado e deixava um vão branco por cima dele.
 * - No Safari do iPhone (PWA) o teclado não encolhe a página: tapa-a e o Safari arrasta a página para cima (o cabeçalho
 *   saía do ecrã). Com o teclado aberto a conversa passa a ocupar só a zona visível (`visualViewport`), como o visor dos
 *   mimos (app/stories). No Android (Chrome) a página encolhe sozinha (interactive-widget=resizes-content): nada a fazer.
 * - O vão branco de ~70 px entre a barra de escrever e o teclado do iPhone: a conversa presa à zona visível punha-se em
 *   `top: visualViewport.offsetTop` dentro do ecrã, o que só está certo se a página não estiver deslocada. No iPhone, ao
 *   abrir o teclado, o Safari desloca a página para mostrar o campo e não deixa sempre voltar ao topo (`scrollTo(0, 0)`
 *   é ignorado enquanto o teclado está aberto): o ecrã subia com a página, a conversa ficava esse tanto acima da zona
 *   visível (o cabeçalho cortado) e por baixo da barra sobrava uma faixa branca até ao teclado. Agora mede-se onde está o
 *   ecrã (`getBoundingClientRect`, nas mesmas coordenadas do `offsetTop`) e desconta-se (`pinnedTop`).
 * - A janela de referência para saber se o teclado está aberto é lib/webViewport `webWindowHeight` (a mesma das folhas,
 *   dos mimos e da Txillada).
 */

/** Na web, o teclado está aberto quando a zona visível é bem mais baixa do que a janela (a barra do Safari não chega). */
export const KEYBOARD_MIN_PX = 120;

export function webKeyboardOpen(visibleHeight: number, windowHeight: number, scale = 1): boolean {
  // Com a página ampliada (zoom) a zona visível também é mais baixa, mas não é o teclado.
  if (Math.abs(scale - 1) > 0.01) return false;
  return visibleHeight > 0 && windowHeight > 0 && visibleHeight < windowHeight - KEYBOARD_MIN_PX;
}

/** A margem de baixo da barra de escrever com o teclado aberto: só a folga normal, colada a ele. */
export const KB_COMPOSER_PAD = 8;

/**
 * O espaço por baixo da pílula da barra de escrever: sem teclado, a margem do sistema mais 8 (pelo menos 14); com o
 * teclado aberto só `KB_COMPOSER_PAD` (antes ficavam os 14 de «sem teclado», uma faixa branca por cima do teclado).
 */
export function composerPad(bottom: number, keyboardOpen: boolean): number {
  return keyboardOpen ? KB_COMPOSER_PAD : Math.max(14, bottom + 8);
}

/**
 * Onde pôr a conversa (`top`, dentro do ecrã que a contém) para ficar no topo da zona visível: `vvTop` é o
 * `visualViewport.offsetTop` e `parentTop` o topo do ecrã (`getBoundingClientRect().top`), os dois contados da janela.
 * Com a página deslocada pelo Safari o ecrã está acima (`parentTop` negativo) e a conversa desce esse tanto.
 */
export function pinnedTop(vvTop: number, parentTop: number): number {
  return Math.round((vvTop || 0) - (parentTop || 0));
}

/** A margem de baixo da barra de escrever: a do sistema, ou nenhuma com o teclado aberto (fica por baixo dele). */
export function composerInset(bottom: number, keyboardOpen: boolean): number {
  return keyboardOpen ? 0 : bottom;
}
