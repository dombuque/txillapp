-- Envio sem rede (app: lib/chatPending): cada mensagem de texto, sticker ou GIF leva um `client_id` (uuid gerado no
-- telemóvel). Se o pedido chegou ao servidor mas a resposta se perdeu, a app volta a enviar com o mesmo `client_id` e o
-- servidor devolve a mensagem que já existe em vez de criar outra (conversas a dois e TxillGroups).
--
-- Único por quem envia; as mensagens sem `client_id` (as antigas e as que não passam pela fila) ficam fora do índice.
ALTER TABLE social.messages ADD COLUMN IF NOT EXISTS client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_client_id_key ON social.messages (sender_id, client_id) WHERE client_id IS NOT NULL;
