/**
 * Temas do Txillapp (para o Explorar). Cada publicação é classificada aqui, com as nossas palavras e hashtags (português de cá),
 * sem serviços externos. As palavras são prefixos: "futeb" apanha futebol, futebolista…
 */
export interface Topic {
  id: string;
  label: string;
  words: string[];
}

export const TOPICS: Topic[] = [
  { id: 'humor', label: 'Humor', words: ['humor', 'piada', 'engracad', 'rir', 'risada', 'kkk', 'haha', 'meme', 'comedia', 'brincadeira', 'palhac', 'paulada', 'morri de'] },
  { id: 'musica', label: 'Música', words: ['music', 'cantor', 'cantar', 'canção', 'cancao', 'album', 'single', 'videoclip', 'clipe', 'marrabenta', 'amapiano', 'afrobeat', 'hiphop', 'hip-hop', 'rap', 'kizomba', 'semba', 'pandza', 'kuduro', 'concerto', 'show', 'dj', 'beat', 'playlist', 'viola', 'guitarr'] },
  { id: 'danca', label: 'Dança', words: ['danc', 'bailar', 'coreograf', 'challenge', 'desafio de danca', 'passinho'] },
  { id: 'comida', label: 'Comida', words: ['comida', 'comer', 'receita', 'cozinh', 'almoc', 'jantar', 'matapa', 'xima', 'caril', 'camarao', 'caranguejo', 'peixe', 'frango', 'pizza', 'hamburguer', 'sobremesa', 'bolo', 'pastel', 'lanche', 'restaurante', 'churrasc', 'grelhad', 'petisco', 'delicia', 'fome', 'gelado'] },
  { id: 'bebidas', label: 'Bebidas', words: ['cerveja', 'gelada', 'cocktail', 'drink', 'vinho', 'whisky', 'whiskey', 'vodka', 'gin', 'brinde', 'saude!', 'bar ', 'cafe', 'cha ', 'sumo'] },
  { id: 'desporto', label: 'Desporto', words: ['futeb', 'golo', 'jogo', 'campeonato', 'liga', 'mambas', 'selecao', 'basquet', 'volei', 'tenis', 'atletismo', 'corrida', 'maratona', 'ginasio', 'treino', 'boxe', 'artes marciais', 'natacao', 'estadio', 'equipa'] },
  { id: 'fitness', label: 'Fitness', words: ['fitness', 'gym', 'musculac', 'treino', 'dieta', 'emagrec', 'saudavel', 'yoga', 'agachament', 'supino'] },
  { id: 'festa', label: 'Festa', words: ['festa', 'aniversario', 'parabens', 'casamento', 'noivo', 'discoteca', 'balada', 'after', 'convivio', 'celebra', 'fim de semana', 'sextou', 'rolê', 'role '] },
  { id: 'viagens', label: 'Viagens', words: ['viagem', 'viajar', 'ferias', 'turismo', 'hotel', 'aeroporto', 'passeio', 'destino', 'ilha', 'safari', 'vilanculos', 'inhambane', 'tofo', 'ponta do ouro', 'bilene', 'xai-xai', 'pemba', 'bazaruto', 'cidade de'] },
  { id: 'natureza', label: 'Natureza', words: ['praia', 'mar ', 'oceano', 'por do sol', 'nascer do sol', 'montanha', 'natureza', 'floresta', 'rio ', 'paisagem', 'animal selvagem', 'jardim', 'chuva'] },
  { id: 'moda', label: 'Moda', words: ['moda', 'look', 'outfit', 'roupa', 'estilo', 'capulana', 'tendencia', 'sapato', 'sneaker', 'fato', 'vestido', 'acessorio', 'tecido'] },
  { id: 'beleza', label: 'Beleza', words: ['beleza', 'maquilh', 'makeup', 'cabelo', 'penteado', 'tranca', 'unhas', 'skincare', 'perfume', 'barbearia', 'barba'] },
  { id: 'carros', label: 'Carros', words: ['carro', 'viatura', 'auto ', 'mota', 'moto', 'camiao', 'camioneta', 'hilux', 'ranger', 'toyota', 'mazda', 'mercedes', 'bmw', 'stand', 'motor', 'tuning', 'drift', 'chapa'] },
  { id: 'familia', label: 'Família', words: ['familia', 'filho', 'filha', 'bebe', 'mae', 'pai ', 'avo', 'irmao', 'irma', 'casa', 'crianca', 'sobrinh', 'gravidez'] },
  { id: 'amor', label: 'Amor', words: ['amor', 'namor', 'casal', 'paixao', 'coracao', 'saudade', 'beijo', 'crush', 'relacionamento', 'amizade'] },
  { id: 'animais', label: 'Animais', words: ['cao', 'cachorro', 'cadela', 'gato', 'animal', 'passaro', 'cavalo', 'pet ', 'cachorrinho', 'gatinho', 'leao', 'elefante'] },
  { id: 'tecnologia', label: 'Tecnologia', words: ['tecnolog', 'telemovel', 'smartphone', 'iphone', 'android', 'app ', 'aplicacao', 'programa', 'codigo', 'computador', 'internet', 'inteligencia artificial', 'startup', 'gadget'] },
  { id: 'negocios', label: 'Negócios', words: ['negocio', 'empreend', 'venda', 'vendo', 'loja', 'cliente', 'promocao', 'dinheiro', 'investiment', 'marketing', 'empresa', 'emprego', 'vaga', 'trabalho', 'servico'] },
  { id: 'estudo', label: 'Estudo', words: ['estud', 'escola', 'universidade', 'exame', 'faculdade', 'aula', 'professor', 'curso', 'bolsa de estudo', 'tpc', 'graduac', 'formatura'] },
  { id: 'noticias', label: 'Notícias', words: ['noticia', 'urgente', 'governo', 'presidente', 'eleic', 'politica', 'comunicado', 'acidente', 'cheias', 'ciclone', 'policia'] },
];

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** As palavras já sem acentos, para comparar. */
const INDEX = TOPICS.map((t) => ({ id: t.id, words: t.words.map((w) => strip(w)) }));

/** Até 3 temas para um texto (e as suas hashtags). Sem correspondência: lista vazia (a publicação só entra no "Para ti"). */
export function classify(body: string, tags: string[] = []): string[] {
  const text = ` ${strip(body)} `;
  const hashes = tags.map((t) => strip(t));
  const scored: { id: string; n: number }[] = [];
  for (const t of INDEX) {
    let n = 0;
    for (const w of t.words) {
      const needle = w.endsWith(' ') ? w : w;
      if (text.includes(needle.length <= 3 ? ` ${needle}` : needle)) n += 1;
      if (hashes.some((h) => h.startsWith(w.trim()))) n += 2; // uma hashtag vale mais
    }
    if (n > 0) scored.push({ id: t.id, n });
  }
  return scored.sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.id);
}

export const topicLabel = (id: string) => TOPICS.find((t) => t.id === id)?.label ?? id;
