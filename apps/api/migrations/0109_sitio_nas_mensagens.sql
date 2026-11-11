-- Localização no chat "como no WhatsApp": além do ponto, um sítio escolhido da lista "Sítios perto" (ou da pesquisa) vai com
-- o nome e a morada, para a bolha os mostrar por cima do mapa. Opcionais: a "localização atual" e a partilha em direto só têm o ponto.
ALTER TABLE social.messages
  ADD COLUMN IF NOT EXISTS place_name text CHECK (place_name IS NULL OR char_length(place_name) <= 80),
  ADD COLUMN IF NOT EXISTS place_address text CHECK (place_address IS NULL OR char_length(place_address) <= 160);
