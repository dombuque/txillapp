-- Brindar uma nota: um brinde por pessoa; desaparecem com a nota (que dura 24 h e não se edita).
CREATE TABLE social.note_cheers (
  note_user_id uuid NOT NULL REFERENCES social.notes(user_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_user_id, user_id)
);
