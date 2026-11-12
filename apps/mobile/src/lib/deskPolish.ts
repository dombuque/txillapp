/**
 * Computador (browser com rato): os detalhes de uma página de computador, de uma vez para a app toda.
 * - mãozinha (`cursor: pointer`) em tudo o que se clica;
 * - foco visível para quem usa o teclado (`:focus-visible`), sem o anel ao clicar com o rato;
 * - dica (`title`) nos botões só com ícone: o `aria-label` que já têm aparece ao passar o rato.
 * Só se instala com `(hover: hover) and (pointer: fine)`: no telemóvel e no PWA do telemóvel nada muda.
 */

export const POLISH_CSS = `[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="switch"],[role="checkbox"],[role="radio"],a[href]{cursor:pointer}
[aria-disabled="true"]{cursor:default}
[role="button"]:focus-visible,[role="link"]:focus-visible,[role="tab"]:focus-visible,[role="menuitem"]:focus-visible,[role="switch"]:focus-visible,a:focus-visible,button:focus-visible,[tabindex]:focus-visible{outline:2px solid #d6334f!important;outline-offset:2px}
input:focus-visible,textarea:focus-visible{outline:2px solid rgba(214,51,79,.45)!important;outline-offset:1px}`;

/**
 * Que dica pôr neste elemento (ou null se não precisa): a `data-tip` que o componente pediu (o react-native-web não passa
 * `title` às Views) ou, nos clicáveis sem texto à vista, o `aria-label`. Nunca por cima de um `title` que já lá esteja.
 */
export function tipFor(el: { getAttribute: (n: string) => string | null; textContent: string | null } | null): string | null {
  if (!el) return null;
  if (el.getAttribute('title')) return null;
  const tip = el.getAttribute('data-tip');
  if (tip) return tip;
  const label = el.getAttribute('aria-label');
  if (!label) return null;
  if ((el.textContent ?? '').trim()) return null;
  return label;
}

const CLICKABLE = '[data-tip],[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="switch"]';
let installed = false;

export function installDeskPolish(): () => void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  if (typeof window.matchMedia !== 'function' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return () => undefined;
  installed = true;
  const tag = document.createElement('style');
  tag.setAttribute('data-tx', 'desk-polish');
  tag.textContent = POLISH_CSS;
  document.head.appendChild(tag);
  const over = (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    const el = t?.closest?.(CLICKABLE) as HTMLElement | null;
    const tip = tipFor(el);
    if (el && tip) el.setAttribute('title', tip);
  };
  document.addEventListener('mouseover', over, { passive: true, capture: true });
  return () => {
    document.removeEventListener('mouseover', over, { capture: true });
    tag.remove();
    installed = false;
  };
}
