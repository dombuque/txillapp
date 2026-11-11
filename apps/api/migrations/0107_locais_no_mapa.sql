-- Locais no mapa: a posição de um local passa a ser escolhida no mapa (até ~6 casas decimais: é um sítio público, não
-- uma pessoa). Quem gere o local pode tirá-lo do mapa: deixa de aparecer como pino e em "perto de mim" por distância
-- (e os eventos dele deixam de levar coordenadas), mas continua a existir, na pesquisa por nome e na sua página.
ALTER TABLE content.venues ADD COLUMN show_on_map boolean NOT NULL DEFAULT true;
