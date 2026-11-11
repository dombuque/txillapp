-- Quem brindou a minha geleira: por omissão só o dono vê a lista. Com isto ligado ("Mostrar quem brindou a minha geleira"),
-- quem pode ver a geleira (mesma regra da geleira, com bloqueios) passa a ver também quem a brindou.
ALTER TABLE identity.users ADD COLUMN geleira_cheers_public boolean NOT NULL DEFAULT false;
