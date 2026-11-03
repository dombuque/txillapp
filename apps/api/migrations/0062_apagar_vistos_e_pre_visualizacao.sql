-- 1) Ficheiros com prazo: o servidor apaga-os quando o prazo passa (fotos/vídeos de "ver uma vez" depois de vistos).
ALTER TABLE content.media_assets ADD COLUMN expires_at timestamptz;
CREATE INDEX media_assets_expires_idx ON content.media_assets (expires_at) WHERE expires_at IS NOT NULL AND status <> 'deleted';
-- 2) Pré-visualização do Zás: miniatura minúscula e desfocada (nunca a foto verdadeira), criada ao enviar.
ALTER TABLE social.instants ADD COLUMN preview text;
