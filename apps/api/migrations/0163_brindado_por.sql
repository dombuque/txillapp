-- «Brindado por @fulano e outras N pessoas» (posts/cheered-by.ts): os brindes mais recentes de cada publicação, por ordem.
-- Sem isto, em cada página do feed lia-se e ordenava-se todos os brindes de cada publicação (numa publicação com muitos
-- brindes, milhares de linhas, cada uma com a regra de privacidade) para escolher três. Serve também a lista «quem brindou».
CREATE INDEX IF NOT EXISTS cheers_post_created_idx ON content.cheers (post_id, created_at DESC);
