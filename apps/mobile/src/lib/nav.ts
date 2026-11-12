/** O mínimo do router de que precisamos (o do expo-router serve). */
export interface BackRouter {
  canGoBack(): boolean;
  back(): void;
  replace(href: never): void;
}

/**
 * «Voltar» com saída: volta ao ecrã anterior; se se entrou direto por uma ligação (sem ecrã anterior), vai para `fallback`.
 * Um `router.back()` sozinho, aberto a frio (/u/x, /p/id…), não fazia nada.
 */
export function goBack(router: BackRouter, fallback = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}
