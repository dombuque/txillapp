-- Catálogo de música curado (ver docs/musica.md): a tarefa periódica guarda aqui as faixas das fontes externas que passam na
-- curadoria; a app lê daqui, nunca das fontes.
CREATE TABLE content.music_catalog (
  id text PRIMARY KEY CHECK (char_length(id) <= 80),
  source text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('music', 'sound')),
  track jsonb NOT NULL,
  styles text[] NOT NULL DEFAULT '{}',
  quality real NOT NULL DEFAULT 0,
  signals jsonb NOT NULL DEFAULT '{}',
  first_seen timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX music_catalog_refreshed_idx ON content.music_catalog (refreshed_at);

-- O que a equipa decidiu no backoffice para uma faixa (de qualquer fonte, incluindo a local): esconder ou destacar.
CREATE TABLE content.music_flags (
  track_id text PRIMARY KEY CHECK (char_length(track_id) <= 80),
  status text NOT NULL CHECK (status IN ('hidden', 'featured')),
  reason text NOT NULL,
  staff_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- «Não gosto desta»: a faixa sai para quem marcou; o backoffice e a ordem para todos só usam as contagens.
CREATE TABLE content.music_dislikes (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  track_id text NOT NULL CHECK (char_length(track_id) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX music_dislikes_track_idx ON content.music_dislikes (track_id);
