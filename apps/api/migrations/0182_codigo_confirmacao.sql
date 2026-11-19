-- Confirmar o e-mail com um código de 6 dígitos escrito na app (além do link): guarda-se só o hash do código (com o id da
-- linha, para dois códigos iguais nunca chocarem no UNIQUE) e quantas vezes se errou (ao fim de 5, pede-se um novo).
ALTER TABLE identity.email_tokens DROP CONSTRAINT IF EXISTS email_tokens_kind_check;
ALTER TABLE identity.email_tokens ADD CONSTRAINT email_tokens_kind_check CHECK (kind IN ('verify', 'reset', 'verify_code'));
ALTER TABLE identity.email_tokens ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

-- O aviso «Segue a malta» (um só, no dia a seguir a confirmar, a quem ainda segue menos de 3): quando saiu.
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS follow_nudged_at timestamptz;
