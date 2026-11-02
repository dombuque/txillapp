-- Mensagens de voz com onda real: ~48 níveis (0 a 9) medidos na gravação, guardados como texto de dígitos.
ALTER TABLE social.messages
  ADD COLUMN waveform text CHECK (waveform IS NULL OR waveform ~ '^[0-9]{8,96}$');
