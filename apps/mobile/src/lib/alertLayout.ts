/**
 * Os botões da caixa de confirmação (AlertHost) cabem lado a lado? Só dois, e cada um com um texto curto: na caixa de
 * 340 de largura, cada botão tem ~140, onde cabem ~12 letras na letra dos botões grandes. Senão, um por cima do outro.
 */
export const ALERT_ROW_MAX_CHARS = 12;
export const alertInRow = (labels: readonly string[]): boolean => labels.length === 2 && labels.every((l) => l.length <= ALERT_ROW_MAX_CHARS);
