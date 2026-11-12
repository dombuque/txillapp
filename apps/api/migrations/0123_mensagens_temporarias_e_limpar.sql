-- Mensagens temporárias (por conversa a dois e por TxillGroup) e "Limpar conversa" (só para mim).
--
-- Mensagens temporárias: `ttl_seconds` = quanto dura cada mensagem enviada daí para a frente (24 h, 7 dias ou 90 dias;
-- NULL = desligadas). Cada mensagem enviada com isso ligado leva `expires_at` (criação + duração); as que já existiam não
-- mudam. Passado o `expires_at` a mensagem deixa de aparecer em todo o lado e a limpeza periódica (src/chat/chat-expiry.service.ts)
-- apaga-a de vez, com o ficheiro.
ALTER TABLE social.conversations ADD COLUMN ttl_seconds integer CHECK (ttl_seconds IN (86400, 604800, 7776000));
ALTER TABLE social.groups ADD COLUMN ttl_seconds integer CHECK (ttl_seconds IN (86400, 604800, 7776000));
ALTER TABLE social.messages ADD COLUMN expires_at timestamptz;
CREATE INDEX messages_expires_idx ON social.messages (expires_at) WHERE expires_at IS NOT NULL;

-- Avisos de sistema na conversa ("Dom ligou as mensagens temporárias: 7 dias."): kind 'system', o texto em `body` (para as
-- versões antigas da app e para a lista) e o que aconteceu em `system` ({ type: 'ttl', ttl, name }). Nunca expiram.
ALTER TABLE social.messages ADD COLUMN system jsonb;
ALTER TABLE social.messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'story_reply', 'story_reaction', 'image', 'voice', 'sticker', 'location', 'post', 'gift', 'video', 'zas_reply', 'call', 'poll', 'gif', 'system'));

-- Limpar conversa (só para mim): nas conversas a dois o cursor já existe (cleared_a/cleared_b, 0096, o mesmo do "Apagar
-- conversa" da lista); `cleared_keep_*` diz que foi "Limpar" e não "Apagar": a conversa fica na lista, vazia, até chegar outra.
ALTER TABLE social.conversations
  ADD COLUMN cleared_keep_a boolean NOT NULL DEFAULT false,
  ADD COLUMN cleared_keep_b boolean NOT NULL DEFAULT false;
-- Nos TxillGroups: a última mensagem (id, UUIDv7) que limpei; daí para trás nada me aparece.
ALTER TABLE social.group_members ADD COLUMN cleared_id uuid;
