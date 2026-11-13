-- O nível da geleira passa a medir o que a pessoa vive com a malta nos últimos 90 dias (ver src/geleira/geleira-level.ts):
-- geladas pagas e confirmadas (do livro e dos pedidos aceites), brindes de seguidores mútuos, check-ins em locais, rodadas
-- fechadas no TxillGroup e, por fim, um pouco dos gostos (variedade e notas, no máximo 8 pontos). O álcool e os Txills não
-- contam nada.
--
-- 1. A cache: o resultado da conta de cada pessoa, para o perfil e o retrato dos posts da geleira lerem a mesma coisa sem
--    refazer a conta a cada pedido. `level` é o nível mostrado (desce no máximo um por semana: `dropped_at` guarda a última
--    descida); `breakdown` traz o detalhe por origem (só o dono o vê). `stale`: algo mudou (os gatilhos de baixo); a próxima
--    leitura, ou a volta de hora a hora, refaz a conta.
CREATE TABLE taste.geleira_levels (
  user_id     uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  points      integer NOT NULL DEFAULT 0,
  level       smallint NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 4),
  breakdown   jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  stale       boolean NOT NULL DEFAULT false,
  dropped_at  timestamptz
);
-- A volta de hora a hora: quem tem pontos (pode descer) ou mudou alguma coisa, os mais antigos primeiro.
CREATE INDEX geleira_levels_refresh_idx ON taste.geleira_levels (computed_at) WHERE stale OR points > 0 OR level > 0;

-- 2. Índices para a conta (cada fonte filtrada pela pessoa e pela janela de 90 dias).
CREATE INDEX IF NOT EXISTS gelada_debts_paid_debtor_idx ON taste.gelada_debts (debtor_id, closed_at) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS gelada_debts_paid_creditor_idx ON taste.gelada_debts (creditor_id, closed_at) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS gelada_requests_accepted_recipient_idx ON taste.gelada_requests (recipient_id, answered_at) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS gelada_requests_accepted_requester_idx ON taste.gelada_requests (requester_id, answered_at) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS geleira_item_cheers_owner_at_idx ON taste.geleira_item_cheers (owner_id, created_at);
CREATE INDEX IF NOT EXISTS gelada_rounds_closed_payer_idx ON taste.gelada_rounds (payer_id, closed_at) WHERE status = 'closed';
-- (content.checkins já tem (user_id, venue_id, created_at); taste.geleira_cheers já tem (owner_id, created_at).)

-- 3. Os gatilhos: uma mudança numa fonte marca a cache das pessoas envolvidas como desatualizada (`stale`). Não refazem a
--    conta (isso é na leitura ou na volta de hora a hora): só uma atualização pela chave, se a linha existir.
--    Os argumentos são as colunas com as pessoas (lidas da linha nova e da antiga).
CREATE FUNCTION taste.geleira_level_stale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c text;
  r jsonb;
  ids uuid[] := '{}';
BEGIN
  FOREACH c IN ARRAY TG_ARGV LOOP
    IF TG_OP <> 'DELETE' THEN
      r := to_jsonb(NEW);
      IF r ->> c IS NOT NULL THEN ids := ids || (r ->> c)::uuid; END IF;
    END IF;
    IF TG_OP <> 'INSERT' THEN
      r := to_jsonb(OLD);
      IF r ->> c IS NOT NULL THEN ids := ids || (r ->> c)::uuid; END IF;
    END IF;
  END LOOP;
  UPDATE taste.geleira_levels SET stale = true WHERE user_id = ANY(ids) AND NOT stale;
  RETURN NULL;
END $$;

-- Uma rodada que fecha (ou muda quem paga) mexe em quem pagou e em todos os que entraram.
CREATE FUNCTION taste.geleira_level_round_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE taste.geleira_levels SET stale = true
   WHERE NOT stale AND (user_id = NEW.payer_id OR user_id = OLD.payer_id OR user_id = NEW.opened_by
         OR user_id IN (SELECT e.user_id FROM taste.gelada_round_entries e WHERE e.round_id = NEW.id));
  RETURN NULL;
END $$;

CREATE TRIGGER geleira_level_debts AFTER INSERT OR DELETE OR UPDATE OF status, closed_at ON taste.gelada_debts
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_stale('debtor_id', 'creditor_id');
CREATE TRIGGER geleira_level_requests AFTER DELETE OR UPDATE OF status, answered_at ON taste.gelada_requests
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_stale('requester_id', 'recipient_id');
CREATE TRIGGER geleira_level_rounds AFTER UPDATE OF status, payer_id, closed_at ON taste.gelada_rounds
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_round_stale();
CREATE TRIGGER geleira_level_round_entries AFTER INSERT OR DELETE ON taste.gelada_round_entries
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_stale('user_id');
CREATE TRIGGER geleira_level_cheers AFTER INSERT OR DELETE ON taste.geleira_cheers
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_stale('owner_id');
CREATE TRIGGER geleira_level_item_cheers AFTER INSERT OR DELETE ON taste.geleira_item_cheers
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_stale('owner_id');
CREATE TRIGGER geleira_level_checkins AFTER INSERT OR DELETE ON content.checkins
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_stale('user_id');
CREATE TRIGGER geleira_level_user_items AFTER INSERT OR DELETE OR UPDATE OF rating, item_id ON taste.user_items
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_stale('user_id');
-- Seguir (os brindes só contam de seguidores mútuos) e bloquear (nada conta com bloqueios) mexem nas duas pessoas.
CREATE TRIGGER geleira_level_follows AFTER INSERT OR DELETE ON social.follows
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_stale('follower_id', 'followee_id');
CREATE TRIGGER geleira_level_blocks AFTER INSERT OR DELETE ON social.blocks
  FOR EACH ROW EXECUTE FUNCTION taste.geleira_level_stale('blocker_id', 'blocked_id');
-- (Uma conta suspensa ou eliminada deixa de contar para os outros na volta de hora a hora.)
