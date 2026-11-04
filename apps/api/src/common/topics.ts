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

  // ── Humor: como as redes grandes, por assunto (o humor é o que mais se partilha, por isso tem mais subtemas).
  { id: 'humor-relacoes', label: 'Humor de relações', words: ['namorad', 'ex ', 'crush', 'solteir', 'casal', 'ciumes', 'ciumento', 'cunhad', 'sogra', 'amor da minha vida', 'relacionamento', 'traicao', 'chifre', 'pedido de casamento', 'quando a tua namorada', 'quando o teu namorado'] },
  { id: 'humor-familia', label: 'Pais e filhos', words: ['mae ', 'pai ', 'filho', 'filha', 'bebe', 'crianca', 'paternidade', 'maternidade', 'quando os pais', 'a minha mae', 'o meu pai', 'sobrinho', 'chupeta', 'fraldas', 'birra'] },
  { id: 'humor-trabalho', label: 'Humor do trabalho', words: ['chefe', 'trabalho', 'segunda-feira', 'reuniao', 'colega', 'salario', 'fim do mes', 'ferias', 'escritorio', 'horas extra', 'patrao', 'emprego', 'sextou'] },
  { id: 'humor-escola', label: 'Humor da escola', words: ['escola', 'professor', 'exame', 'teste', 'faculdade', 'universidade', 'nota', 'tpc', 'colega de turma', 'estudar', 'chumbar', 'passei'] },
  { id: 'humor-rua', label: 'Humor da rua', words: ['chapa', 'machimbombo', 'autocarro', 'trânsito', 'transito', 'mercado', 'bairro', 'vizinho', 'vendedor', 'zungueir', 'taxi', 'multa', 'fila', 'calor', 'sem luz', 'sem agua', 'sem rede', 'carregamento'] },
  { id: 'memes', label: 'Memes', words: ['meme', 'viral', 'trend', 'tendencia', 'template', 'reacao', 'quando tu', 'a cara quando', 'pov', 'ninguem:', 'eu quando', 'mood'] },
  { id: 'partidas', label: 'Partidas e reações', words: ['partida', 'pegadinha', 'prank', 'susto', 'reacao', 'surpresa', 'cai ', 'queda', 'fail', 'quase', 'ficou assustado'] },
  { id: 'comedia', label: 'Comédia', words: ['stand-up', 'standup', 'comediante', 'sketch', 'esquete', 'imitac', 'parodia', 'personagem', 'novela', 'humorista', 'espetaculo de humor'] },
  // ── Mais assuntos
  { id: 'gaming', label: 'Jogos', words: ['jogo ', 'jogos', 'gamer', 'gaming', 'playstation', 'ps5', 'xbox', 'fifa', 'fortnite', 'minecraft', 'free fire', 'pubg', 'streamer', 'consola'] },
  { id: 'cinema', label: 'Cinema e séries', words: ['filme', 'cinema', 'serie', 'netflix', 'trailer', 'ator', 'atriz', 'realizador', 'estreia', 'novela', 'episodio', 'temporada', 'anime'] },
  { id: 'famosos', label: 'Famosos', words: ['famoso', 'celebridade', 'artista', 'influencer', 'influenciador', 'cantor', 'cantora', 'atriz', 'ator', 'apresentador', 'miss ', 'entrevista'] },
  { id: 'arte', label: 'Arte e design', words: ['arte', 'pintura', 'desenho', 'ilustrac', 'escultura', 'artesanato', 'design', 'grafit', 'galeria', 'exposicao', 'tela', 'makonde', 'cerâmica', 'ceramica'] },
  { id: 'fotografia', label: 'Fotografia', words: ['foto ', 'fotograf', 'camera', 'lente', 'retrato', 'ensaio', 'sessao fotografica', 'photography', 'drone', 'filmagem'] },
  { id: 'casa', label: 'Casa e decoração', words: ['decorac', 'sala ', 'cozinha', 'quarto', 'mobilia', 'sofa', 'reforma', 'obra', 'pintar a casa', 'jardim', 'quintal', 'construc', 'arquitet', 'imovel', 'apartamento', 'renda'] },
  { id: 'saude', label: 'Saúde e bem-estar', words: ['saude', 'medic', 'hospital', 'clinica', 'sono', 'meditac', 'bem-estar', 'bem estar', 'mental', 'terapia', 'vacina', 'dentista', 'alimentacao saudavel', 'hidrat'] },
  { id: 'fe', label: 'Fé', words: ['deus', 'igreja', 'oracao', 'fe ', 'biblia', 'louvor', 'pastor', 'culto', 'jesus', 'mesquita', 'abencoad', 'gracas a deus', 'amem'] },
  { id: 'motivacao', label: 'Motivação', words: ['motivac', 'inspirac', 'sucesso', 'sonho', 'foco', 'disciplina', 'nunca desistas', 'frase', 'reflexao', 'conselho', 'superacao', 'lideranca'] },
  { id: 'ciencia', label: 'Ciência e curiosidades', words: ['ciencia', 'curiosidade', 'sabias que', 'descoberta', 'espaco', 'planeta', 'quimica', 'fisica', 'biologia', 'experiencia', 'historia de', 'invent'] },
  { id: 'historia', label: 'História e cultura', words: ['historia', 'cultura', 'tradic', 'ancestr', 'independencia', 'heroi', 'museu', 'patrimonio', 'lingua', 'changana', 'sena', 'makua', 'ronga', 'capulana', 'ilha de mocambique'] },
  { id: 'pesca', label: 'Pesca e mar', words: ['pesca', 'pescador', 'barco', 'dhow', 'mergulho', 'surf', 'onda', 'oceano', 'baleia', 'tubarao', 'marisco'] },
  { id: 'agricultura', label: 'Campo e agricultura', words: ['machamba', 'agricult', 'campo', 'colheita', 'milho', 'mandioca', 'gado', 'horta', 'sementes', 'cajueiro', 'cultivo', 'trator'] },
  { id: 'casamentos', label: 'Casamentos', words: ['casamento', 'noiva', 'noivo', 'lobolo', 'igreja casamento', 'convidados', 'vestido de noiva', 'madrinha', 'padrinho', 'wedding', 'lua de mel'] },
  { id: 'solidariedade', label: 'Solidariedade', words: ['solidari', 'doacao', 'ajuda', 'voluntari', 'apoio', 'campanha', 'orfanato', 'caridade', 'ong', 'comunidade', 'ciclone', 'cheias'] },
  { id: 'cabelo', label: 'Cabelo e barbearia', words: ['cabelo', 'tranca', 'penteado', 'barbearia', 'barbeiro', 'corte', 'tranças', 'rasta', 'peruca', 'alisamento', 'cacho'] },
  { id: 'danca2', label: 'Coreografias', words: ['coreograf', 'passo de danca', 'danca do', 'challenge de danca', 'duo de danca', 'batida', 'amapiano dance', 'rebolar'] },
];

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** As palavras já sem acentos, para comparar. */
const INDEX = TOPICS.map((t) => ({ id: t.id, words: t.words.map((w) => strip(w)) }));

/** Até 3 temas para um texto (e as suas hashtags). Sem correspondência: lista vazia (a publicação só entra no "Para ti"). */
export function classify(body: string, tags: string[] = []): string[] {
  // Só no início das palavras ("amor" não apanha "namorada"); a pontuação conta como espaço.
  const text = ` ${strip(body).replace(/[^a-z0-9\- ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const hashes = tags.map((t) => strip(t));
  const scored: { id: string; n: number }[] = [];
  for (const t of INDEX) {
    let n = 0;
    for (const w of t.words) {
      const needle = w.replace(/[^a-z0-9\- ]+/g, '');
      if (!needle.trim()) continue;
      if (text.includes(` ${needle.trimStart()}`)) n += 1;
      if (hashes.some((h) => h.startsWith(needle.trim()))) n += 2; // uma hashtag vale mais
    }
    // O humor por assunto é mais específico: a pontuação de um subtema não fica atrás de um tema geral.
    if (n > 0) scored.push({ id: t.id, n: t.id.startsWith('humor-') ? n + 1 : n });
  }
  return scored.sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.id);
}

export const topicLabel = (id: string) => TOPICS.find((t) => t.id === id)?.label ?? id;
