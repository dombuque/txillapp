-- O idioma escolhido no ecrã «Idiomas» (docs/idiomas-api.md). Serve para os pushes, as notificações com texto feito no
-- servidor e os e-mails, que saem no idioma de quem os RECEBE. As respostas aos pedidos seguem o Accept-Language.
--
-- NULL = a pessoa não escolheu (a app segue o idioma do telemóvel; os pushes e e-mails saem em português).
-- Apagar a conta volta a pô-lo a NULL.
--
-- Juntar um idioma: acrescentar o código à lista LANGS de packages/shared e, numa migração nova, refazer esta regra com
-- a lista nova (as duas linhas do fim, com o código a mais).

ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS language text;

ALTER TABLE identity.users DROP CONSTRAINT IF EXISTS users_language_check;
ALTER TABLE identity.users ADD CONSTRAINT users_language_check CHECK (language IN ('pt', 'en'));
