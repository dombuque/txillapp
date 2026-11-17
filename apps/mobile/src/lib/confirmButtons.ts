import type { AlertButton } from './alertHost';
import { t } from '@/lib/i18n';

export type ConfirmOptions = {
  title: string;
  message?: string;
  /** O texto do botão que confirma («Apagar», «Sair»…). Por omissão «Confirmar». */
  confirm?: string;
  /** O texto do botão que não faz nada. Por omissão «Cancelar». */
  cancel?: string;
  /** Ação perigosa (apagar, bloquear, sair): o botão fica vermelho. */
  danger?: boolean;
};

/** Os dois botões da caixa: primeiro o que não faz nada, depois o que confirma. `done(true)` só no que confirma. */
export function confirmButtons(o: ConfirmOptions, done: (ok: boolean) => void): AlertButton[] {
  return [
    { text: o.cancel ?? t('Cancelar'), style: 'cancel', onPress: () => done(false) },
    { text: o.confirm ?? t('Confirmar'), style: o.danger ? 'destructive' : 'default', onPress: () => done(true) },
  ];
}
