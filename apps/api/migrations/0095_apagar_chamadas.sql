-- Histórico de chamadas: cada lado pode apagar a sua cópia (uma ou todas), sem mexer no histórico do outro.
-- As chamadas com mais de 12 meses são apagadas automaticamente.
ALTER TABLE social.calls
  ADD COLUMN hidden_by_caller boolean NOT NULL DEFAULT false,
  ADD COLUMN hidden_by_callee boolean NOT NULL DEFAULT false;
CREATE INDEX calls_created_idx ON social.calls (created_at);
