-- Para quem vai um Zás: "friends" = amigos próximos e quem se segue mutuamente; "close" = só os amigos próximos.
ALTER TABLE social.instants ADD COLUMN audience text NOT NULL DEFAULT 'friends' CHECK (audience IN ('friends', 'close'));
