/** Nos grupos, cada pessoa tem a sua cor (sempre a mesma), escolhida das cores do Txillapp: coral, laranja, âmbar (cerveja), verde, verde-azulado, vinho e tons de tinta. */
const PALETTE = ['#d6334f', '#ea580c', '#b45309', '#15803d', '#0f766e', '#9f1239', '#3f3f46', '#4d7c0f'];

export function senderColor(username: string): string {
  let h = 7;
  for (const c of username.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
