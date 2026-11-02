-- Links curtos e limpos: cada publicação tem um código de 7 letras e números (sem letras que se confundem), usado em txillapp.com/p/Ab3xK9q.
-- Não é um segredo: quem pode ver a publicação continua a ser decidido pela privacidade da conta.
ALTER TABLE content.posts ADD COLUMN short_code text;

CREATE FUNCTION content.new_short_code() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  code text;
  i int;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..7 LOOP
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM content.posts WHERE short_code = code);
  END LOOP;
  RETURN code;
END $$;

-- As publicações que já existem também ficam com o seu código.
UPDATE content.posts SET short_code = content.new_short_code() WHERE short_code IS NULL;
ALTER TABLE content.posts ALTER COLUMN short_code SET NOT NULL;
CREATE UNIQUE INDEX posts_short_code_idx ON content.posts (short_code);

-- As novas recebem-no ao nascer (os sítios que criam publicações não precisam de saber disto).
CREATE FUNCTION content.set_post_short_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.short_code IS NULL THEN NEW.short_code := content.new_short_code(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER posts_set_short_code BEFORE INSERT ON content.posts FOR EACH ROW EXECUTE FUNCTION content.set_post_short_code();
