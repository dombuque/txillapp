-- Política de mensagens de quem não se segue: pedidos de mensagem.
-- aceite_x: a pessoa já aceitou falar; escondida_x: recusou (não vê a conversa nem recebe avisos dela). As conversas que já existem ficam aceites.
ALTER TABLE social.conversations
  ADD COLUMN accepted_a boolean NOT NULL DEFAULT false,
  ADD COLUMN accepted_b boolean NOT NULL DEFAULT false,
  ADD COLUMN hidden_a boolean NOT NULL DEFAULT false,
  ADD COLUMN hidden_b boolean NOT NULL DEFAULT false;
UPDATE social.conversations SET accepted_a = true, accepted_b = true;
