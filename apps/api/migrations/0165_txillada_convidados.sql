-- Txillada com convidados (docs/txillada-contrato.md): o anfitrião e até 3 convidados a transmitir ao mesmo tempo.
--
-- Uma linha por pessoa e Txillada (a última vez que pediu, foi convidada ou transmitiu), que muda de estado:
--   `kind`: quem começou — 'request' (a pessoa pediu para entrar) ou 'invite' (o anfitrião convidou-a da lista «A ver agora»).
--   `status`: 'pending' (à espera da resposta), 'accepted' (está a transmitir), 'declined' (recusado: pelo anfitrião, se foi um
--   pedido; pela pessoa, se foi um convite), 'cancelled' (a pessoa desistiu do pedido, o anfitrião retirou o convite, ou a
--   Txillada acabou antes da resposta), 'left' (saiu de transmitir, ou a Txillada acabou) e 'removed' (o anfitrião tirou-a,
--   expulsou-a ou houve um bloqueio).
--   `since`: quando passou a transmitir (a ordem dos quadrados no ecrã).
-- No máximo 3 'accepted' por Txillada (o serviço conta-os com a linha da Txillada trancada). Os vídeos não se gravam; esta
-- tabela apaga-se 7 dias depois do fim (com os comentários) e sai com a conta (das duas pontas, pelo CASCADE e pelo serviço).
CREATE TABLE content.txillada_guests (
  txillada_id uuid NOT NULL REFERENCES content.txilladas (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('request', 'invite')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'left', 'removed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  since       timestamptz,
  PRIMARY KEY (txillada_id, user_id)
);
CREATE INDEX txillada_guests_user_idx ON content.txillada_guests (user_id);
-- Quem está a transmitir e quem está à espera (o DTO de cada pedido e a contagem dos 3).
CREATE INDEX txillada_guests_open_idx ON content.txillada_guests (txillada_id, status) WHERE status IN ('pending', 'accepted');
