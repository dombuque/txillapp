-- «A tocar…»: quando um aparelho de quem recebe confirmou que a chamada chegou (POST /calls/:id/ringing). Até lá, quem
-- liga vê «A chamar…». Fica a primeira confirmação; as seguintes não mudam nada.
ALTER TABLE social.calls ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
