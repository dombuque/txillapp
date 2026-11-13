-- Fotos recusadas pela verificação automática (só com prova de nudez: ver image-moderation.service.ts): em vez de se
-- apagarem logo, ficam 'rejected' (ninguém as vê nem as pode usar) durante 7 dias, para o dono poder «Pedir revisão»
-- (POST /media/:id/appeal). Com o recurso vão para a fila da moderação e ficam até à decisão: aprovada, a foto passa a
-- 'ready' e pode ser publicada; removida, apaga-se. Sem recurso, apagam-se ao fim dos 7 dias (MediaService.sweepDeleted).
ALTER TABLE content.media_assets DROP CONSTRAINT media_assets_status_check;
ALTER TABLE content.media_assets ADD CONSTRAINT media_assets_status_check
  CHECK (status IN ('pending', 'uploaded', 'processing', 'ready', 'rejected', 'deleted'));

ALTER TABLE content.media_assets
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN appealed_at timestamptz,
  ADD COLUMN appeal_decided_at timestamptz;

-- A limpeza dos 7 dias e o limite de recursos por pessoa.
CREATE INDEX media_assets_rejected_idx ON content.media_assets (rejected_at) WHERE status = 'rejected';
CREATE INDEX media_assets_appeals_idx ON content.media_assets (owner_id, appealed_at) WHERE appealed_at IS NOT NULL;

-- A impressão digital (SHA-256) dos bytes recebidos de uma foto recusada. Se a moderação a aprovar, fica na lista de
-- fotos aprovadas do dono: a mesma foto enviada de novo (um mimo ou um Zás que se volta a publicar) já não é recusada.
ALTER TABLE content.media_assets ADD COLUMN content_sha256 bytea;
CREATE TABLE content.appeal_approved_photos (
  owner_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  sha256 bytea NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, sha256)
);
