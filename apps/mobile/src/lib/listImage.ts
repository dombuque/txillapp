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

/**
 * Quantas páginas de um carrossel ficam montadas. No telemóvel cada foto montada é um bitmap descodificado no heap nativo
 * (~2 MB numa foto de 720 px) e o FlatList montava as 10 primeiras de cada carrossel: com o feed cheio de carrosséis de 9
 * fotos, eram ~120 MB de bitmaps (58 fotos) só nas vistas montadas. Fica a página que se vê e as vizinhas. Na web fica
 * como estava (lá as fotos já são lazy e o virtualizar fazia-as piscar ao voltar).
 */
export function carouselWindowProps(os: string): { initialNumToRender?: number; maxToRenderPerBatch?: number; windowSize?: number } {
  if (os === 'web') return {};
  return { initialNumToRender: 2, maxToRenderPerBatch: 2, windowSize: 3 };
}
