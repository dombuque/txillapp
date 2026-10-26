-- Quem pode ver QUEM repostou, brindou ou presenteou nas minhas publicações (os números continuam públicos).
ALTER TABLE identity.users
  ADD COLUMN reposts_visible text NOT NULL DEFAULT 'everyone' CHECK (reposts_visible IN ('everyone', 'followers', 'off')),
  ADD COLUMN cheers_visible  text NOT NULL DEFAULT 'everyone' CHECK (cheers_visible  IN ('everyone', 'followers', 'off')),
  ADD COLUMN gifts_visible   text NOT NULL DEFAULT 'followers' CHECK (gifts_visible   IN ('everyone', 'followers', 'off'));
