-- Cada país é a sua própria rede. A pessoa tem o país onde está agora (atualizado a cada pedido, a partir do IP) e
-- cada publicação guarda o país de quem a escreveu quando a publicou. A descoberta (feed de sugestões, reels, pesquisa,
-- hashtags, sugestões de pessoas) só mostra o que é do mesmo país; quem segues continua a aparecer-te onde quer que estejas.
ALTER TABLE identity.users ADD COLUMN country char(2);
ALTER TABLE content.posts ADD COLUMN country char(2);

-- O que já existe nasceu em Moçambique (o único país até agora).
UPDATE identity.users SET country = 'MZ' WHERE country IS NULL;
UPDATE content.posts SET country = 'MZ' WHERE country IS NULL;

CREATE INDEX posts_country_created_idx ON content.posts (country, created_at DESC) WHERE removed_at IS NULL;
CREATE INDEX users_country_idx ON identity.users (country);

-- Publicação nova herda o país onde o autor está agora (os 3 sítios que criam publicações não precisam de saber disto).
CREATE OR REPLACE FUNCTION content.set_post_country() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.country IS NULL THEN
    SELECT u.country INTO NEW.country FROM identity.users u WHERE u.id = NEW.author_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posts_set_country BEFORE INSERT ON content.posts FOR EACH ROW EXECUTE FUNCTION content.set_post_country();
