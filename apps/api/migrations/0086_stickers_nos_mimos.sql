-- Stickers pousados sobre o mimo: lista de {id, x, y, s, r} (posição e tamanho relativos ao ecrã, rotação em graus).
ALTER TABLE content.stories ADD COLUMN stickers jsonb;
