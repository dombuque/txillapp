-- Guardar uma tcheka (posts/post-download.service.ts, `GET /posts/:id/download`): Definições → Conteúdo → «Deixar guardar as
-- minhas tchekas» (ligado por omissão). Numa conta privada ou de um menor (menos de 18 anos, ou sem data de nascimento) vale
-- sempre como desligado: os outros não guardam as tchekas dela. O próprio autor pode sempre guardar as suas.
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS allow_downloads boolean NOT NULL DEFAULT true;
