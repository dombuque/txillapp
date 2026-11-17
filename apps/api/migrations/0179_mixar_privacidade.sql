-- Mixar: privacidade (docs/mixar-contrato.md, «Privacidade (0179)»). Três escolhas na conta, em Definições → Privacidade →
-- Mixar, como as outras definições de privacidade (colunas em identity.users, lidas e mudadas por GET/PATCH /users/me/privacy).
-- Todas ligadas por omissão (é o que o Mixar fazia até aqui).
--
-- 1. «Mostrar que estou a ver contigo» («ver juntos»): desligada, a minha presença no Mixar não se guarda nem se anuncia
--    (os outros não sabem que estou no Mixar nem em que item). Continuo a ver onde estão os outros que a deixam ligada.
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS mixar_presence boolean NOT NULL DEFAULT true;
-- 2. «Aparecer nas sugestões de Mixar»: desligada, não apareço no «Faz um Mixar com…» de ninguém.
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS mixar_suggestable boolean NOT NULL DEFAULT true;
-- 3. «Deixar que o resumo da semana me inclua»: desligada, o outro não partilha (Zás ou mimos) nem descarrega o cartão do
--    resumo da semana do nosso Mixar. Dentro do Mixar, o resumo continua a ver-se pelos dois.
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS mixar_week_include boolean NOT NULL DEFAULT true;

-- 4. Eliminar a conta: o Mixar de grupo que a pessoa propôs continua para os outros, mas sem o id dela (fica sem quem propôs).
--    No Mixar a dois nunca fica NULL (sai com a conta).
ALTER TABLE social.mixars ALTER COLUMN invited_by DROP NOT NULL;
