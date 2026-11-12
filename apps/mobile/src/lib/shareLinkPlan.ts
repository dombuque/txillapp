/**
 * O que vai para `Share.share` quando se partilha uma ligação. No iPhone e no browser a ligação vai à parte (`url`) e a app
 * de destino junta-a ao texto: por isso o texto vai sem ela, senão aparece duas vezes. No Android a folha só leva texto,
 * por isso a ligação vai no fim do texto.
 */
export function linkSharePlan(os: string, text: string, url: string): { message: string; url?: string } | { message?: string; url: string } {
  const t = text.trim();
  if (os === 'android') return { message: t ? `${t} ${url}` : url };
  return t ? { message: t, url } : { url };
}
