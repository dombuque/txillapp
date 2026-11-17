-- Txillada: reabrir uma Angariação que o anfitrião acabou antes da meta (docs/txillada-contrato.md, «Reabrir (0174)»).
--
-- `reopens`: quantas vezes já se reabriu (no máximo 3). `reopened_at`: a última vez (o aviso aos seguidores ao reabrir segue
-- o limite de uma vez por hora do anfitrião). A mesma linha volta a 'live' com uma sala nova no LiveKit.
ALTER TABLE content.txilladas
  ADD COLUMN IF NOT EXISTS reopens int NOT NULL DEFAULT 0 CHECK (reopens >= 0),
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;
