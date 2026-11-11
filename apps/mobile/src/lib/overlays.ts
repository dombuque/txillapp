import { useEffect } from 'react';

/**
 * Quantas coisas estão abertas por cima dos ecrãs (folhas, a câmara e os Zás, a visita guiada, caixas de confirmação…).
 * Quem quer aparecer "de tempos a tempos" (o lembrete das notificações) só aparece quando não há nenhuma.
 */
let open = 0;

/** Marca uma coisa como aberta; devolve a função que a fecha (chamá-la duas vezes não faz mal). */
export function overlayOpen(): () => void {
  open++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    open = Math.max(0, open - 1);
  };
}

export const overlaysOpen = (): number => open;

/** Enquanto `active`, conta como aberta. */
export function useOverlay(active = true): void {
  useEffect(() => (active ? overlayOpen() : undefined), [active]);
}
