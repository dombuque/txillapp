-- O SuperTxill escreve ao vivo (0166): a resposta entra logo com o texto que o modelo já escreveu e vai sendo atualizada
-- (de ~1 em ~1 s) até ficar pronta. `writing` fica verdadeiro enquanto o modelo ainda está a escrever.
ALTER TABLE social.ai_messages ADD COLUMN IF NOT EXISTS writing boolean NOT NULL DEFAULT false;
