/**
 * Os tipos do canvas do browser que renderOverlays.ts e renderTransitions.ts (cópias do estúdio do site) usam, aqui ligados
 * ao canvas do Node (@napi-rs/canvas). A API compila sem a biblioteca «dom».
 */
import type { Canvas, Image, SKRSContext2D } from '@napi-rs/canvas';

declare global {
  type CanvasRenderingContext2D = SKRSContext2D;
  type CanvasImageSource = Canvas | Image;
  type HTMLCanvasElement = Canvas;
}
export {};
