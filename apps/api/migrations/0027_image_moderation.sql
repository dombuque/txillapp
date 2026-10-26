-- Verificação automática de fotos: guarda a pontuação e permite denúncias do sistema (sem denunciante).
ALTER TABLE content.media_assets ADD COLUMN nsfw_score real;

ALTER TABLE social.reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE social.reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE social.reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post', 'comment', 'story', 'user', 'message', 'media'));
-- Uma só denúncia automática por foto.
CREATE UNIQUE INDEX reports_system_media_once ON social.reports (target_id) WHERE reporter_id IS NULL AND target_type = 'media';
