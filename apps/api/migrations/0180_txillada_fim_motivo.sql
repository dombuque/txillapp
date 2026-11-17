-- Txillada: a ligação do anfitrião cai (docs/txillada-contrato.md, «Ligação do anfitrião (0180)»).
--
-- `host_gone_at`: desde quando o anfitrião está fora da sala (saiu, caiu, a sala fechou ou ficou sem nenhuma faixa); NULL
-- quando está lá. Ao fim de 3 min fora (confirmado no LiveKit), a Txillada acaba sozinha com `end_reason = 'lost'`.
-- Desligar só a câmara (fica o som) não conta. `end_reason`: porque acabou (só 'lost'; NULL nos outros casos).
-- `resumes`: quantas vezes o anfitrião a continuou depois de a ligação cair (até 10 min depois; cada vez com uma sala nova).
ALTER TABLE content.txilladas
  ADD COLUMN IF NOT EXISTS host_gone_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_reason text CHECK (end_reason IN ('lost')),
  ADD COLUMN IF NOT EXISTS resumes int NOT NULL DEFAULT 0 CHECK (resumes >= 0);
