/**
 * Os tipos do canvas do browser que renderOverlays.ts e renderTransitions.ts (cópias do estúdio do site) usam, aqui ligados
 * ao canvas do Node (@napi-rs/canvas). A API compila sem a biblioteca «dom». O `HTMLCanvasElement` vai como interface (e não
 * como um alias): o @types/react, que na imagem Docker está na raiz por causa da web, declara-o vazio no global.d.ts dele, e
 * as duas declarações juntam-se.
 */
import type { Canvas, Image, SKRSContext2D } from '@napi-rs/canvas';

declare global {
  type CanvasRenderingContext2D = SKRSContext2D;
  type CanvasImageSource = Canvas | Image;
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface HTMLCanvasElement extends Canvas {}
}
export {};
