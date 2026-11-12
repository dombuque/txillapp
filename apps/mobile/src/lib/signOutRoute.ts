/**
 * Para onde se vai depois de terminar sessão (Definições → Terminar sessão, ou Eliminar conta).
 * - Passou para outra conta guardada neste aparelho: o Início dessa conta (nunca o ecrã de entrar, que piscava e voltava).
 * - No browser normal: a página principal, que sem sessão é a apresentação do Txillapp.
 * - Na app instalada (telemóvel ou PWA): o ecrã de entrar.
 * Navega-se logo para o destino final, para o ecrã das Definições (já sem conta) não ficar à vista nem ser guardado como
 * "voltar aqui depois de entrar".
 */
export function afterSignOutRoute(switched: boolean, web: boolean, standalone: boolean): '/' | '/login' {
  if (switched) return '/';
  return web && !standalone ? '/' : '/login';
}
