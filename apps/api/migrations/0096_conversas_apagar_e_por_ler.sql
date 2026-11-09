-- Lista de mensagens: apagar a conversa só do meu lado (as mensagens até ali deixam de aparecer para mim; uma nova faz a conversa voltar)
-- e marcar como por ler (fica com a bolinha até eu a abrir).
ALTER TABLE social.conversations
  ADD COLUMN cleared_a uuid,
  ADD COLUMN cleared_b uuid,
  ADD COLUMN unread_mark_a boolean NOT NULL DEFAULT false,
  ADD COLUMN unread_mark_b boolean NOT NULL DEFAULT false;
