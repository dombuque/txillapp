-- Brindar um story é como o gosto do Instagram: conta e mostra quem brindou, sem enviar mensagem.
CREATE TABLE content.story_cheers (
  story_id   uuid NOT NULL REFERENCES content.stories(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);
CREATE INDEX story_cheers_user_idx ON content.story_cheers (user_id);
