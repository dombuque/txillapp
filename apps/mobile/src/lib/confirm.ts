import { openAlert } from './alertHost';
import { confirmButtons, type ConfirmOptions } from './confirmButtons';

export type { ConfirmOptions } from './confirmButtons';

/**
 * Pergunta de sim/não na caixa da app (AlertHost), igual no telemóvel e no site:
 *   if (await confirm({ title: 'Apagar o rascunho?', confirm: 'Apagar', danger: true })) …
 * Dá `true` só se a pessoa carregar no botão que confirma; fechar a caixa (fora, voltar, outra caixa por cima) dá `false`.
 */
export function confirm(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    openAlert(o.title, o.message, confirmButtons(o, done), () => done(false));
  });
}
