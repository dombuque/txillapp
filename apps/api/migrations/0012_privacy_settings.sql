-- Centro de privacidade: quem pode comentar/presentear, visibilidade das listas, sugestões e bloqueios.
ALTER TABLE identity.users
  ADD COLUMN comments_allowed text NOT NULL DEFAULT 'everyone' CHECK (comments_allowed IN ('everyone', 'following', 'off')),
  ADD COLUMN gifts_allowed    text NOT NULL DEFAULT 'everyone' CHECK (gifts_allowed IN ('everyone', 'following', 'off')),
  ADD COLUMN show_connections text NOT NULL DEFAULT 'everyone' CHECK (show_connections IN ('everyone', 'followers', 'me')),
  ADD COLUMN suggestable      boolean NOT NULL DEFAULT true;

-- Bloquear: nenhuma das partes vê o conteúdo da outra, nem se pode seguir ou interagir.
CREATE TABLE social.blocks (
  blocker_id uuid NOT NULL REFERENCES identity.users(id),
  blocked_id uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON social.blocks (blocked_id, blocker_id);
