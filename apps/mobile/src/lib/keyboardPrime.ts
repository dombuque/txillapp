/**
 * Abrir o teclado logo ao abrir uma folha com um campo (a nota de um amigo, o editor da minha nota), também no iPhone.
 *
 * No Safari do iPhone (e no PWA) o teclado só abre se o foco for dado DENTRO do toque da pessoa. O campo da folha ainda
 * não existe nesse instante (aparece no render seguinte) e o `autoFocus` dele chega tarde: o cursor fica lá, mas o
 * teclado não abre. O truque de sempre: no próprio toque, foca-se um campo invisível (o teclado abre) e, quando o campo
 * de verdade aparece e fica com o foco, o invisível sai (`releaseKeyboard`) e o teclado fica aberto, agora no campo certo.
 * Se nada lhe pegar, sai sozinho ao fim de 1,5 s. Só na web com ecrã de toque; no computador e no nativo não faz nada
 * (lá o `autoFocus` chega).
 */
let proxy: { remove: () => void } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function primeKeyboard(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (!coarse) return;
  releaseKeyboard();
  const el = document.createElement('input');
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  // 16 px: com menos o Safari amplia a página ao focar.
  el.setAttribute('style', 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;pointer-events:none');
  document.body.appendChild(el);
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  proxy = el;
  timer = setTimeout(releaseKeyboard, 1500);
}

/** O campo de verdade já tem o foco (ou desistiu-se): o invisível sai. */
export function releaseKeyboard(): void {
  clearTimeout(timer);
  proxy?.remove();
  proxy = null;
}
