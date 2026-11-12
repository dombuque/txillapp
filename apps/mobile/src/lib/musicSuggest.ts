/**
 * Sugere o estilo de música a partir do que a pessoa escreveu (texto e local do post, do mimo ou da nota).
 * Simples e do lado da app: procura palavras do dia a dia e escolhe o estilo com mais acertos.
 * Devolve só um dos estilos do catálogo do servidor (MUSIC_STYLES em apps/api/src/music/catalog/track.ts).
 */
export type MusicStyleId = 'afrobeats' | 'amapiano' | 'pandza' | 'marrabenta' | 'kizomba' | 'hiphop' | 'rnb' | 'gospel' | 'chill' | 'festa' | 'romantico' | 'praia';
/** O nome antigo (antes eram géneros soltos); fica para quem o importava. */
export type MusicGenre = MusicStyleId;

const RULES: { genre: MusicStyleId; why: string; words: string[] }[] = [
  { genre: 'festa', why: 'festa', words: ['festa', 'festival', 'discoteca', 'balada', 'sextou', 'role', 'aniversario', 'parabens', 'dancar', 'danca', 'noite', 'after', 'celebr', 'convivio', 'bebida', 'farra'] },
  { genre: 'amapiano', why: 'amapiano', words: ['amapiano', 'piano piano', 'log drum', 'joanesburgo', 'joburg', 'mzansi'] },
  { genre: 'pandza', why: 'pandza', words: ['pandza', 'kuduro', 'xigubo'] },
  { genre: 'marrabenta', why: 'Moçambique', words: ['marrabenta', 'maputo', 'mocambique', 'matola', 'beira', 'nampula', 'inhambane', 'xai-xai', 'quelimane', 'tete', 'pemba', 'chimoio', 'machimbombo', 'mamana'] },
  { genre: 'afrobeats', why: 'África', words: ['afro', 'africa', 'naija', 'lagos', 'gana', 'ghana', 'wizkid', 'burna'] },
  { genre: 'kizomba', why: 'dança a dois', words: ['kizomba', 'zouk', 'semba', 'tarraxinha', 'angola', 'luanda', 'cabo verde'] },
  { genre: 'praia', why: 'praia', words: ['praia', 'mar ', 'sol ', 'ferias', 'verao', 'tofo', 'bilene', 'ponta do ouro', 'ilha', 'piscina', 'onda', 'surf', 'por do sol', 'barra'] },
  { genre: 'romantico', why: 'amor', words: ['amor', 'namorad', 'saudade', 'casamento', 'noiv', 'coracao', 'paixao', 'beijo', 'aniversario de namoro', 'meu bem', 'linda', 'lindo'] },
  { genre: 'hiphop', why: 'treino e atitude', words: ['treino', 'gym', 'ginasio', 'fitness', 'corrida', 'futebol', 'basket', 'skate', 'rap', 'trap', 'swag', 'bora', 'hustle', 'grind'] },
  { genre: 'rnb', why: 'noite calma', words: ['rnb', 'r&b', 'soul', 'vibe', 'mood', 'sentimento'] },
  { genre: 'gospel', why: 'fé e família', words: ['igreja', 'oracao', 'deus', 'jesus', 'fe ', 'bencao', 'abencoad', 'culto', 'louvor', 'gracas', 'amen', 'domingo'] },
  { genre: 'chill', why: 'calma', words: ['relax', 'calma', 'descanso', 'natureza', 'paisagem', 'amanhecer', 'cafe', 'estudo', 'estudar', 'foco', 'livro', 'leitura', 'chuva', 'casa', 'sofa', 'lofi', 'chill'] },
];

const norm = (s: string) => ` ${s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;

export function suggestMusic(text: string | null | undefined): { genre: MusicStyleId; why: string } | null {
  const t = norm(text ?? '');
  if (t.trim().length < 3) return null;
  let best: { genre: MusicStyleId; why: string; n: number } | null = null;
  for (const r of RULES) {
    const n = r.words.filter((w) => t.includes(w.endsWith(' ') ? ` ${w}` : w)).length;
    if (n > 0 && (!best || n > best.n)) best = { genre: r.genre, why: r.why, n };
  }
  return best ? { genre: best.genre, why: best.why } : null;
}
