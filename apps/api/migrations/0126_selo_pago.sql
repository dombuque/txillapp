-- Um terceiro nível de selo: 'paid' (verificação paga, a azul). Os outros dois ficam como estão, mas passam a vermelho
-- na app: 'verified' (verificado pelo Txillapp por mérito ou pedido aceite) e 'official' (conta oficial do Txillapp).
-- As contas que já têm selo não mudam (ainda não há verificação paga, por isso nenhuma fica azul).
-- A regra da 0049 foi escrita na coluna, sem nome; o Postgres chama-lhe users_verified_tier_check. Para não depender do
-- nome, tira-se qualquer regra da tabela que fale de verified_tier e põe-se a nova com nome fixo.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'identity.users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%verified_tier%'
  LOOP
    EXECUTE format('ALTER TABLE identity.users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE identity.users ADD CONSTRAINT users_verified_tier_check CHECK (verified_tier IN ('verified', 'official', 'paid'));
