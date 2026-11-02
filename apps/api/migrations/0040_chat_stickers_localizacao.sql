-- Chat: stickers (o texto é o id do sticker) e localização (latitude/longitude escolhidas por quem envia, uma vez, sem seguimento).
ALTER TABLE social.messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'story_reply', 'story_reaction', 'image', 'voice', 'sticker', 'location'));
ALTER TABLE social.messages
  ADD COLUMN lat double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  ADD COLUMN lng double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180);
