/**
 * "Ver uma vez": o que o visor mostra (components/OnceViewer), sem React (testado em tests/onceView.test.mjs).
 * O servidor (POST /chat/messages/:id/open) devolve o tipo, o texto e o endereço; antes tudo o que tinha endereço era
 * mostrado como imagem (o vídeo e a voz ficavam num ecrã preto).
 */
export interface OnceContent { kind: string; url: string | null; body: string }

export function onceView(c: OnceContent): 'image' | 'video' | 'voice' | 'text' {
  if (c.url && c.kind === 'video') return 'video';
  if (c.url && c.kind === 'voice') return 'voice';
  if (c.url && c.kind !== 'text') return 'image';
  return 'text';
}
