-- Publicações guardadas à espera de um pedido de revisão (HeldPublicationsService): quem pede a revisão de uma foto
-- recusada pode mandar também o rascunho da publicação (publicação/tcheka, mimo ou Zás, com o mesmo corpo do endpoint de
-- publicar). Aprovada a foto, o servidor publica-a sozinho e avisa; removida, descarta-se. Vale 7 dias.
-- Enquanto está 'held', os outros ficheiros do rascunho contam como em uso (media-refs.ts: ACTIVE_HELD_PAYLOAD).
CREATE TABLE content.held_publications (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('post', 'story', 'instant')),
  media_id uuid NOT NULL REFERENCES content.media_assets(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'published', 'failed', 'discarded', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  decided_at timestamptz,
  result_id uuid,
  error text
);
-- Uma publicação guardada por foto em revisão.
CREATE UNIQUE INDEX held_publications_one ON content.held_publications (media_id) WHERE status = 'held';
CREATE INDEX held_publications_owner_idx ON content.held_publications (owner_id, created_at);
CREATE INDEX held_publications_expiry_idx ON content.held_publications (expires_at) WHERE status = 'held';
