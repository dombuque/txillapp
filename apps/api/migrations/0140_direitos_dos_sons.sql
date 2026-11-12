-- Direitos nos sons e nos duetos das tchekas (docs/sons.md, secções 5 a 7).
--
-- 1. «Retirar o som» pelo próprio autor: quem tirou o som (o autor, a equipa por direitos, ou a conta eliminada). A tcheka que
--    usava um som tirado mostra «Som retirado pelo autor» ou «Som retirado por direitos de autor».
ALTER TABLE content.sounds ADD COLUMN IF NOT EXISTS removed_by text CHECK (removed_by IS NULL OR removed_by IN ('author', 'staff', 'account'));
UPDATE content.sounds SET removed_by = CASE WHEN removed_reason = 'Conta eliminada' THEN 'account' ELSE 'staff' END
 WHERE removed_at IS NOT NULL AND removed_by IS NULL;
-- Quando o servidor acabou de tirar o áudio das tchekas que usavam o som (o som vem gravado no vídeo de cada uma, por isso
-- deixar de tocar é tirar a pista de áudio do vídeo). Vazio num som tirado: ainda há tchekas por silenciar.
ALTER TABLE content.sounds ADD COLUMN IF NOT EXISTS silenced_at timestamptz;
CREATE INDEX IF NOT EXISTS sounds_to_silence ON content.sounds (removed_at) WHERE removed_at IS NOT NULL AND silenced_at IS NULL;
-- As tchekas que usam um som original guardam-no em music (kind 'sound', soundId): para as achar sem ler a tabela toda.
CREATE INDEX IF NOT EXISTS posts_music_sound_idx ON content.posts ((music->>'soundId')) WHERE music->>'kind' = 'sound';

-- Cada vídeo a que se tirou o áudio por causa de um som. `backup`: guardou-se uma cópia privada do vídeo com o som (só quando
-- foi a equipa a tirar o som, para o poder repor se a decisão for revista; quando é o autor ou a conta eliminada, não há cópia).
CREATE TABLE IF NOT EXISTS content.sound_silenced (
  media_id    uuid PRIMARY KEY REFERENCES content.media_assets(id) ON DELETE CASCADE,
  sound_id    text NOT NULL REFERENCES content.sounds(id) ON DELETE CASCADE,
  post_id     uuid REFERENCES content.posts(id) ON DELETE SET NULL,
  backup      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sound_silenced_sound ON content.sound_silenced (sound_id);

-- 2. Dueto retirado pelo autor da tcheka original (ou pela conta dele eliminada): a publicação fica escondida para todos, como
--    uma apagada, com removed_by = 'original'.
ALTER TABLE content.posts DROP CONSTRAINT IF EXISTS posts_removed_by_check;
ALTER TABLE content.posts ADD CONSTRAINT posts_removed_by_check CHECK (removed_by IS NULL OR removed_by IN ('author', 'moderation', 'original'));

-- 3. Avisos novos:
--    - 'sound_review': o meu som foi suspenso por uma denúncia, tirado, reposto ou deixou de estar em análise. Em nome do
--      Txillapp e não se desliga (como os outros avisos da equipa). Na suspensão não há pessoa da equipa (e nunca se diz quem
--      denunciou): o ator é a própria pessoa, como no aviso de verificação.
--      data: { soundId, decision: 'held' | 'removed' | 'cleared' | 'restored', reason?, postId? (a tcheka de onde saiu) }.
--    - 'remix_takedown': o autor da tcheka original retirou o meu dueto (ator = esse autor). data: { postId (o dueto), originalId }.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['sound_review', 'remix_takedown'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;
ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_check CHECK (user_id <> actor_id OR kind IN ('verified', 'sound_review'));
