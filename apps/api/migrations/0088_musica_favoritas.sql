-- Músicas favoritas: cada pessoa marca faixas de licença aberta para as ter à mão (a faixa fica guardada tal como foi validada).
CREATE TABLE content.music_favorites (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  track_id text NOT NULL CHECK (char_length(track_id) BETWEEN 1 AND 80),
  track jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);
-- Para contar as faixas mais usadas (sugestões): o id da música nos posts e nos mimos.
CREATE INDEX posts_music_id_idx ON content.posts ((music->>'id')) WHERE music IS NOT NULL;
CREATE INDEX stories_music_id_idx ON content.stories ((music->>'id')) WHERE music IS NOT NULL;
