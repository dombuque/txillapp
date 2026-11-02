-- Visualização única: o destinatário abre uma vez; ao abrir, o conteúdo é apagado do servidor (texto, ficheiro e onda).
-- Localização em direto: a posição vai sendo atualizada pelo remetente até live_until (15 min, 1 h ou 8 h) e pode ser parada antes.
ALTER TABLE social.messages
  ADD COLUMN view_once boolean NOT NULL DEFAULT false,
  ADD COLUMN viewed_at timestamptz,
  ADD COLUMN live_until timestamptz;
