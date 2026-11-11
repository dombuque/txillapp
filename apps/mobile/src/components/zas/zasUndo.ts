/**
 * A janela para desfazer um Zás (pura, testada em tests/zasUndo.test.mjs). O Zás só é criado no servidor quando a janela
 * acaba: durante esses segundos a foto já está a subir, mas ninguém o pode receber, e "Desfazer" só tem de o cancelar.
 */
export const ZAS_UNDO_MS = 6000;

/** Segundos que faltam, para a contagem (6…1); 0 quando a janela acabou. */
export function undoSecondsLeft(sentAt: number, now: number, ms = ZAS_UNDO_MS): number {
  const left = sentAt + ms - now;
  return left <= 0 ? 0 : Math.min(Math.ceil(ms / 1000), Math.ceil(left / 1000));
}

/** Parte da janela que ainda falta (1 → 0), para a barra a esvaziar. */
export function undoFraction(sentAt: number, now: number, ms = ZAS_UNDO_MS): number {
  if (!(ms > 0)) return 0;
  return Math.min(1, Math.max(0, (sentAt + ms - now) / ms));
}

/** Quanto falta esperar (em ms) antes de criar o Zás no servidor; 0 se a janela já passou (por ex. a subida demorou). */
export const waitBeforeCreate = (sentAt: number, now: number, ms = ZAS_UNDO_MS) => Math.max(0, sentAt + ms - now);

/** Espera até ao fim da janela, mas acorda logo se o Zás for desfeito. Devolve true se foi desfeito. */
export async function waitUndoWindow(sentAt: number, cancelled: () => boolean, ms = ZAS_UNDO_MS, step = 150): Promise<boolean> {
  while (!cancelled() && waitBeforeCreate(sentAt, Date.now(), ms) > 0) {
    await new Promise((r) => setTimeout(r, Math.min(step, waitBeforeCreate(sentAt, Date.now(), ms))));
  }
  return cancelled();
}
