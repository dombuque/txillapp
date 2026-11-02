-- A visibilidade é da geleira inteira (e não de cada item): todos, seguidores, amigos próximos ou só eu.
-- Quem já tinha itens escondidos mantém a privacidade: a geleira passa para o nível mais restrito que usava.
ALTER TABLE identity.users
  ADD COLUMN geleira_visibility text NOT NULL DEFAULT 'everyone' CHECK (geleira_visibility IN ('everyone', 'followers', 'close_friends', 'me')),
  ADD COLUMN website text CHECK (website IS NULL OR char_length(website) <= 100),
  ADD COLUMN city text CHECK (city IS NULL OR char_length(city) <= 40);

UPDATE identity.users u SET geleira_visibility = 'followers'
 WHERE EXISTS (SELECT 1 FROM taste.user_items i WHERE i.user_id = u.id AND i.visibility = 'followers');
UPDATE identity.users u SET geleira_visibility = 'me'
 WHERE EXISTS (SELECT 1 FROM taste.user_items i WHERE i.user_id = u.id AND i.visibility = 'me');
