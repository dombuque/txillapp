-- Verificação mais completa: tipo de documento (nem sempre o BI), frente e verso, leitura da cara (câmara) e selfie ao lado do documento.
-- Todos os ficheiros são privados e apagam-se logo que há decisão.
ALTER TABLE identity.verification_requests
  ADD COLUMN doc_type          text CHECK (doc_type IN ('id_card', 'passport', 'driver_licence', 'residence', 'other')),
  ADD COLUMN doc_back_media_id uuid REFERENCES content.media_assets(id),
  ADD COLUMN face_media_id     uuid REFERENCES content.media_assets(id);
