-- Geleira: a prateleira de gostos de cada pessoa (vibes, bebidas, comidas e sítios que frequenta).
-- Serve para o perfil e, mais tarde, para recomendações e sugestões de malta com a mesma vibe.
CREATE SCHEMA IF NOT EXISTS taste;

CREATE TABLE taste.items (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('vibe', 'bebida', 'comida', 'sitio')),
  -- Grupo dentro do tipo (cerveja, prato de rua, bar…). O cliente escolhe o ícone a partir daqui.
  category text NOT NULL,
  -- Bebida alcoólica: não existe para menores de 18 anos.
  alcoholic boolean NOT NULL DEFAULT false,
  -- Itens sugeridos pela malta ficam 'pending' (só o autor os vê) até a moderação aprovar.
  status text NOT NULL DEFAULT 'curated' CHECK (status IN ('curated', 'pending', 'rejected')),
  created_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX taste_items_kind_idx ON taste.items (kind, status);
CREATE INDEX taste_items_name_idx ON taste.items (lower(name));

CREATE TABLE taste.user_items (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES taste.items(id) ON DELETE CASCADE,
  -- Escala de gelo: 1 "morno" … 5 "gelada de rachar". Nulo = só guardou, ainda sem nota.
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  favorite boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'everyone' CHECK (visibility IN ('everyone', 'followers', 'me')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX taste_user_items_item_idx ON taste.user_items (item_id);

-- Definição global: usar a minha geleira para recomendar (ligada por omissão, desligável).
-- welcomed_at: quando acabou (ou saltou) a visita guiada; as contas que já existem não a voltam a ver.
ALTER TABLE identity.users
  ADD COLUMN geleira_matching boolean NOT NULL DEFAULT true,
  ADD COLUMN welcomed_at timestamptz;
UPDATE identity.users SET welcomed_at = now() WHERE welcomed_at IS NULL;

-- Catálogo curado (idempotente: o id vem do slug, por isso voltar a correr não duplica).
INSERT INTO taste.items (id, slug, name, kind, category, alcoholic)
SELECT md5('taste:' || v.slug)::uuid, v.slug, v.name, v.kind, v.category, v.alcoholic
FROM (VALUES
  -- vibes
  ('vibe-chill', 'Chill em casa', 'vibe', 'calma', false),
  ('vibe-sofa-series', 'Sofá e séries', 'vibe', 'calma', false),
  ('vibe-leitura', 'Ler com calma', 'vibe', 'calma', false),
  ('vibe-musica-baixinho', 'Música baixinho', 'vibe', 'calma', false),
  ('vibe-pe-na-areia', 'Pé na areia', 'vibe', 'ar-livre', false),
  ('vibe-por-do-sol', 'Pôr do sol', 'vibe', 'ar-livre', false),
  ('vibe-aventura', 'Aventura e estrada', 'vibe', 'ar-livre', false),
  ('vibe-natureza', 'Natureza', 'vibe', 'ar-livre', false),
  ('vibe-churrasco', 'Churrasco com a malta', 'vibe', 'convivio', false),
  ('vibe-conversa', 'Conversa até tarde', 'vibe', 'convivio', false),
  ('vibe-jogos', 'Jogos e desafios', 'vibe', 'convivio', false),
  ('vibe-familia', 'Família à mesa', 'vibe', 'convivio', false),
  ('vibe-festa', 'Festa e animação', 'vibe', 'festa', false),
  ('vibe-danca', 'Dançar sem parar', 'vibe', 'festa', false),
  ('vibe-marrabenta', 'Marrabenta', 'vibe', 'musica', false),
  ('vibe-amapiano', 'Amapiano', 'vibe', 'musica', false),
  ('vibe-hiphop', 'Hip-hop e rap', 'vibe', 'musica', false),
  ('vibe-pandza', 'Pandza e kuduro', 'vibe', 'musica', false),
  ('vibe-afrobeats', 'Afrobeats', 'vibe', 'musica', false),
  ('vibe-futebol', 'Futebol', 'vibe', 'desporto', false),
  ('vibe-ginasio', 'Ginásio e treino', 'vibe', 'desporto', false),
  ('vibe-corrida', 'Correr de manhã', 'vibe', 'desporto', false),
  ('vibe-madrugador', 'Madrugador', 'vibe', 'rotina', false),
  ('vibe-noctambulo', 'Noctívago', 'vibe', 'rotina', false),
  -- bebidas (sem álcool)
  ('beb-coca-cola', 'Coca-Cola', 'bebida', 'refrigerante', false),
  ('beb-fanta', 'Fanta', 'bebida', 'refrigerante', false),
  ('beb-sprite', 'Sprite', 'bebida', 'refrigerante', false),
  ('beb-tonica', 'Água tónica', 'bebida', 'refrigerante', false),
  ('beb-sumol', 'Sumol', 'bebida', 'refrigerante', false),
  ('beb-cappy', 'Sumo Cappy', 'bebida', 'sumo', false),
  ('beb-maracuja', 'Sumo de maracujá', 'bebida', 'sumo', false),
  ('beb-manga', 'Sumo de manga', 'bebida', 'sumo', false),
  ('beb-laranja', 'Sumo de laranja', 'bebida', 'sumo', false),
  ('beb-ananas', 'Sumo de ananás', 'bebida', 'sumo', false),
  ('beb-agua-coco', 'Água de coco', 'bebida', 'sumo', false),
  ('beb-cafe', 'Café', 'bebida', 'cafe-cha', false),
  ('beb-cha-limao', 'Chá de limão', 'bebida', 'cafe-cha', false),
  ('beb-cha-gengibre', 'Chá de gengibre', 'bebida', 'cafe-cha', false),
  ('beb-cappuccino', 'Cappuccino', 'bebida', 'cafe-cha', false),
  ('beb-energetica', 'Bebida energética', 'bebida', 'refrigerante', false),
  ('beb-agua', 'Água fresquinha', 'bebida', 'refrigerante', false),
  ('beb-batido', 'Batido de fruta', 'bebida', 'sumo', false),
  -- bebidas (alcoólicas: só para maiores de 18)
  ('beb-laurentina', 'Laurentina', 'bebida', 'cerveja', true),
  ('beb-2m', '2M', 'bebida', 'cerveja', true),
  ('beb-manica', 'Manica', 'bebida', 'cerveja', true),
  ('beb-castle', 'Castle', 'bebida', 'cerveja', true),
  ('beb-heineken', 'Heineken', 'bebida', 'cerveja', true),
  ('beb-cerveja-milho', 'Cerveja de milho tradicional', 'bebida', 'tradicional', true),
  ('beb-cajueiro', 'Aguardente de caju', 'bebida', 'tradicional', true),
  ('beb-vinho-tinto', 'Vinho tinto', 'bebida', 'vinho', true),
  ('beb-vinho-branco', 'Vinho branco', 'bebida', 'vinho', true),
  ('beb-vinho-rose', 'Vinho rosé', 'bebida', 'vinho', true),
  ('beb-espumante', 'Espumante', 'bebida', 'vinho', true),
  ('beb-whisky', 'Whisky', 'bebida', 'destilado', true),
  ('beb-vodka', 'Vodka', 'bebida', 'destilado', true),
  ('beb-gin', 'Gin tónico', 'bebida', 'destilado', true),
  ('beb-rum', 'Rum', 'bebida', 'destilado', true),
  ('beb-ginjinha', 'Ginjinha', 'bebida', 'destilado', true),
  ('beb-cocktail', 'Cocktails', 'bebida', 'destilado', true),
  ('beb-sidra', 'Sidra', 'bebida', 'cerveja', true),
  -- comidas
  ('com-matapa', 'Matapa', 'comida', 'prato-tipico', false),
  ('com-xima-caril', 'Xima com caril', 'comida', 'prato-tipico', false),
  ('com-caril-amendoim', 'Caril de amendoim', 'comida', 'prato-tipico', false),
  ('com-frango-zambeziana', 'Frango à zambeziana', 'comida', 'prato-tipico', false),
  ('com-camarao-piripiri', 'Camarão ao piri-piri', 'comida', 'marisco', false),
  ('com-lagosta', 'Lagosta grelhada', 'comida', 'marisco', false),
  ('com-caranguejo', 'Caranguejo', 'comida', 'marisco', false),
  ('com-ostras', 'Ostras', 'comida', 'marisco', false),
  ('com-peixe-grelhado', 'Peixe grelhado', 'comida', 'grelhados', false),
  ('com-frango-grelhado', 'Frango grelhado', 'comida', 'grelhados', false),
  ('com-espetadas', 'Espetadas', 'comida', 'grelhados', false),
  ('com-bife', 'Bife com ovo e batata', 'comida', 'grelhados', false),
  ('com-feijoada', 'Feijoada', 'comida', 'prato-tipico', false),
  ('com-mucapata', 'Mucapata', 'comida', 'prato-tipico', false),
  ('com-mandioca-cozida', 'Mandioca cozida', 'comida', 'prato-tipico', false),
  ('com-arroz-coco', 'Arroz de coco', 'comida', 'prato-tipico', false),
  ('com-badjias', 'Badjias', 'comida', 'rua', false),
  ('com-samosas', 'Samosas', 'comida', 'rua', false),
  ('com-chamussas', 'Chamuças', 'comida', 'rua', false),
  ('com-rissois', 'Rissóis', 'comida', 'rua', false),
  ('com-pao-chourico', 'Pão com chouriço', 'comida', 'rua', false),
  ('com-pao-frango', 'Pão com frango', 'comida', 'rua', false),
  ('com-prego', 'Prego no pão', 'comida', 'rua', false),
  ('com-hamburguer', 'Hambúrguer', 'comida', 'rua', false),
  ('com-pizza', 'Pizza', 'comida', 'rua', false),
  ('com-batata-frita', 'Batata frita', 'comida', 'rua', false),
  ('com-kebab', 'Kebab', 'comida', 'rua', false),
  ('com-sushi', 'Sushi', 'comida', 'internacional', false),
  ('com-massa', 'Massa', 'comida', 'internacional', false),
  ('com-salada', 'Salada', 'comida', 'internacional', false),
  ('com-vegetariano', 'Pratos vegetarianos', 'comida', 'internacional', false),
  ('com-bolinhos', 'Bolinhos', 'comida', 'doce', false),
  ('com-pasteis-nata', 'Pastéis de nata', 'comida', 'doce', false),
  ('com-gelado', 'Gelado', 'comida', 'doce', false),
  ('com-bolo', 'Bolo', 'comida', 'doce', false),
  ('com-chocolate', 'Chocolate', 'comida', 'doce', false),
  ('com-manga-verde', 'Manga com sal e piri-piri', 'comida', 'doce', false),
  ('com-pipocas', 'Pipocas', 'comida', 'doce', false),
  ('com-amendoim', 'Amendoim torrado', 'comida', 'petisco', false),
  ('com-castanha-caju', 'Castanha de caju', 'comida', 'petisco', false),
  ('com-pequeno-almoco', 'Pequeno-almoço reforçado', 'comida', 'petisco', false),
  -- sítios (tipos de sítio onde a malta anda; sítios com nome entram por sugestão)
  ('sit-bar', 'Bares', 'sitio', 'noite', false),
  ('sit-discoteca', 'Discotecas', 'sitio', 'noite', false),
  ('sit-lounge', 'Lounges', 'sitio', 'noite', false),
  ('sit-karaoke', 'Karaoke', 'sitio', 'noite', false),
  ('sit-esplanada', 'Esplanadas', 'sitio', 'comer-beber', false),
  ('sit-restaurante', 'Restaurantes', 'sitio', 'comer-beber', false),
  ('sit-barraca', 'Barracas e tasquinhas', 'sitio', 'comer-beber', false),
  ('sit-cafe', 'Cafés', 'sitio', 'comer-beber', false),
  ('sit-pastelaria', 'Pastelarias', 'sitio', 'comer-beber', false),
  ('sit-praia', 'Praia', 'sitio', 'ar-livre', false),
  ('sit-jardim', 'Jardins e parques', 'sitio', 'ar-livre', false),
  ('sit-miradouro', 'Miradouros', 'sitio', 'ar-livre', false),
  ('sit-piscina', 'Piscina', 'sitio', 'ar-livre', false),
  ('sit-mercado', 'Mercados', 'sitio', 'dia-a-dia', false),
  ('sit-centro-comercial', 'Centros comerciais', 'sitio', 'dia-a-dia', false),
  ('sit-cinema', 'Cinema', 'sitio', 'dia-a-dia', false),
  ('sit-estadio', 'Estádio', 'sitio', 'dia-a-dia', false),
  ('sit-ginasio', 'Ginásio', 'sitio', 'dia-a-dia', false),
  ('sit-biblioteca', 'Biblioteca', 'sitio', 'dia-a-dia', false)
) AS v(slug, name, kind, category, alcoholic)
ON CONFLICT (slug) DO NOTHING;
