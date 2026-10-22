-- Foto de perfil: aponta para uma imagem já carregada (mesmo fluxo de upload das publicações).
ALTER TABLE identity.users ADD COLUMN avatar_media_id uuid REFERENCES content.media_assets(id);
