-- Presente na conversa: a mensagem mostra quanto foi e a nota. Cada presente (transação) só aparece uma vez no chat.
ALTER TABLE social.messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'story_reply', 'story_reaction', 'image', 'voice', 'sticker', 'location', 'post', 'gift'));
ALTER TABLE social.messages
  ADD COLUMN gift_amount integer CHECK (gift_amount IS NULL OR gift_amount > 0),
  ADD COLUMN gift_tx uuid;
CREATE UNIQUE INDEX messages_gift_tx_idx ON social.messages (gift_tx) WHERE gift_tx IS NOT NULL;
