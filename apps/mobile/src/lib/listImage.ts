/**
 * Fotos dentro de listas que rolam (feed, perfis, mimos): como pedir a imagem ao expo-image sem a fazer piscar na web.
 *
 * Na web o expo-image usa por omissão `loading="lazy"` e o fade de entrada (`transition`) recomeça sempre que o `<img>`
 * é montado. A lista do feed é virtualizada (os cartões longe do ecrã desmontam-se e voltam a montar-se) e, no Safari
 * do iPhone, uma imagem lazy dentro de um contentor com scroll só começa a carregar quando já está no ecrã (o Safari
 * não tem a margem que o Chrome dá às imagens lazy em scrollers). Resultado: ao rolar, cada foto aparecia cinzenta e
 * depois entrava a esmaecer — o "pisca". Na web: carrega logo que o cartão monta (a lista já só monta perto do ecrã) e
 * sem fade (vinda da cache aparece já pintada). No nativo fica como estava (o `loading` não existe lá).
 *
 * `eager = false` deixa lazy (por exemplo as fotos de um carrossel que ainda estão longe da que se vê).
 */
export function listImageProps(os: string, fadeMs: number, eager = true): { transition: number; loading?: 'eager' | 'lazy' } {
  if (os !== 'web') return { transition: fadeMs };
  return { transition: 0, loading: eager ? 'eager' : 'lazy' };
}
