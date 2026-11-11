-- Apagar e editar mensagens como no WhatsApp.
--
-- "Apagar para mim": qualquer mensagem (minha ou de outra pessoa, numa conversa ou num TxillGroup) fica escondida só
-- para quem a apagou. Os outros continuam a vê-la. A conversa e a lista de conversas não mostram as que apaguei para mim.
CREATE TABLE social.message_hidden (
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES social.messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX message_hidden_message_idx ON social.message_hidden (message_id);

-- "Apagar para todos" passa a deixar no lugar da mensagem o aviso "Esta mensagem foi apagada". As que já tinham sido
-- apagadas antes disto foram-no com a promessa de "sem deixar rasto": essas continuam a não aparecer (ficam a false).
ALTER TABLE social.messages ADD COLUMN deleted_notice boolean NOT NULL DEFAULT false;

-- "Editar" (as minhas mensagens de texto, nos primeiros 15 minutos): quando foi editada. A bolha mostra "editada".
ALTER TABLE social.messages ADD COLUMN edited_at timestamptz;
