/**
 * Sugere o género de música a partir do que a pessoa escreveu (texto e local do post ou do story).
 * Simples e do lado da app: procura palavras do dia a dia e escolhe o género com mais acertos.
 * Devolve só um dos géneros que o seletor de música tem (chill, dance, afro, pop, rock, hip hop, jazz, piano, acoustic).
 */
export type MusicGenre = 'chill' | 'dance' | 'afro' | 'pop' | 'rock' | 'hip hop' | 'jazz' | 'piano' | 'acoustic';

const RULES: { genre: MusicGenre; why: string; words: string[] }[] = [
  { genre: 'dance', why: 'festa', words: ['festa', 'festival', 'discoteca', 'balada', 'sextou', 'rolê', 'role', 'aniversario', 'parabens', 'dancar', 'danca', 'noite', 'after', 'celebr', 'convivio'] },
  { genre: 'afro', why: 'Moçambique e África', words: ['maputo', 'mocambique', 'marrabenta', 'pandza', 'amapiano', 'africa', 'matola', 'beira', 'nampula', 'afro', 'xigubo', 'tofo', 'inhambane'] },
  { genre: 'chill', why: 'praia e calma', words: ['praia', 'mar ', 'sol ', 'ferias', 'viagem', 'natureza', 'paisagem', 'por do sol', 'amanhecer', 'relax', 'calma', 'descanso', 'domingo', 'piscina', 'ilha'] },
  { genre: 'pop', why: 'amor e alegria', words: ['amor', 'namorad', 'saudade', 'casamento', 'noiv', 'coracao', 'feliz', 'alegria', 'sorriso', 'amiga', 'amigo', 'obrigad'] },
  { genre: 'hip hop', why: 'treino e atitude', words: ['treino', 'gym', 'ginasio', 'fitness', 'corrida', 'futebol', 'basket', 'skate', 'rap', 'swag', 'bora'] },
  { genre: 'rock', why: 'concertos e energia', words: ['concerto', 'banda', 'show', 'palco', 'guitarra', 'rock', 'energia', 'moto', 'estrada'] },
  { genre: 'jazz', why: 'café e jantar', words: ['cafe', 'jantar', 'almoco', 'restaurante', 'vinho', 'cozinha', 'brunch', 'bar ', 'cocktail', 'sobremesa'] },
  { genre: 'piano', why: 'estudo e foco', words: ['estudo', 'estudar', 'trabalho', 'foco', 'livro', 'leitura', 'universidade', 'exame', 'escritorio', 'chuva'] },
  { genre: 'acoustic', why: 'família e casa', words: ['familia', 'casa', 'mae', 'pai', 'filho', 'filha', 'avo', 'irmao', 'irma', 'bebe', 'lar', 'paz', 'oracao', 'igreja'] },
];

const norm = (s: string) => ` ${s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')} `;

export function suggestMusic(text: string | null | undefined): { genre: MusicGenre; why: string } | null {
  const t = norm(text ?? '');
  if (t.trim().length < 3) return null;
  let best: { genre: MusicGenre; why: string; n: number } | null = null;
  for (const r of RULES) {
    const n = r.words.filter((w) => t.includes(w.endsWith(' ') ? ` ${w}` : w)).length;
    if (n > 0 && (!best || n > best.n)) best = { genre: r.genre, why: r.why, n };
  }
  return best ? { genre: best.genre, why: best.why } : null;
}
