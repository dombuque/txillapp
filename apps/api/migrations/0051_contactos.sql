-- Encontrar amigos pelos contactos do telemóvel: a app calcula o resumo (SHA-256) dos emails dos contactos no aparelho e só envia esses resumos.
-- Cada pessoa pode escolher não ser encontrada assim.
ALTER TABLE identity.users
  ADD COLUMN find_by_contacts boolean NOT NULL DEFAULT true,
  ADD COLUMN email_sha256 text;

CREATE FUNCTION identity.email_sha256(e text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS
  $$ SELECT encode(sha256(convert_to(lower(btrim(e)), 'UTF8')), 'hex') $$;

UPDATE identity.users SET email_sha256 = identity.email_sha256(email::text);

CREATE FUNCTION identity.users_set_email_sha256() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN NEW.email_sha256 := identity.email_sha256(NEW.email::text); RETURN NEW; END $$;
CREATE TRIGGER users_email_sha256 BEFORE INSERT OR UPDATE OF email ON identity.users
  FOR EACH ROW EXECUTE FUNCTION identity.users_set_email_sha256();

CREATE INDEX users_email_sha256_idx ON identity.users (email_sha256);
