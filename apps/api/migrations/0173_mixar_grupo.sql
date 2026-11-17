-- Mixar de grupo (docs/mixar-contrato.md, «Mixar de grupo (0173)»; src/mixar/mixar-grupo.service.ts e mixar-grupo-pick.ts).
--
-- Um TxillGroup (social.groups) com 3 a 5 membros pode ter um Mixar de grupo: a mesma linha de social.mixars, com `group_id`
-- e sem par (user_a e user_b ficam NULL). Assim os itens, as reações, os vistos, o desafio, os comentários, os Guardados, os
-- temas tirados, as aberturas e os avisos (todas as tabelas penduradas em social.mixars) servem também para o grupo, sem
-- tabelas repetidas. O Mixar a dois não muda: todas as consultas dele procuram `user_a = eu OR user_b = eu`, o que nunca
-- apanha uma linha de grupo.

-- 1. A linha do Mixar: ou um par (como até aqui) ou um grupo.
ALTER TABLE social.mixars ALTER COLUMN user_a DROP NOT NULL;
ALTER TABLE social.mixars ALTER COLUMN user_b DROP NOT NULL;
-- Apagar o grupo apaga o Mixar dele (com tudo o que está pendurado, pelo CASCADE).
ALTER TABLE social.mixars ADD COLUMN group_id uuid REFERENCES social.groups(id) ON DELETE CASCADE;
ALTER TABLE social.mixars ADD CONSTRAINT mixars_pair_or_group CHECK (
  (group_id IS NULL AND user_a IS NOT NULL AND user_b IS NOT NULL) OR (group_id IS NOT NULL AND user_a IS NULL AND user_b IS NULL)
);
-- Um só Mixar de grupo (pendente ou ativo) por grupo; um novo depois de acabar cria outra linha.
CREATE UNIQUE INDEX mixars_group_open_idx ON social.mixars (group_id) WHERE group_id IS NOT NULL AND status IN ('pending', 'active');
CREATE INDEX mixars_group_idx ON social.mixars (group_id) WHERE group_id IS NOT NULL;

-- 2. Quem está no Mixar do grupo. Sem linha = ainda não respondeu. `state`: 'in' (aceitou, ou propôs), 'declined' («Agora
--    não»: pode entrar mais tarde) e 'left' (saiu do Mixar ou do grupo; também pode voltar a entrar enquanto o Mixar durar).
--    Os participantes são os 'in' que continuam no grupo (quem sai do grupo passa a 'left' pelo gatilho abaixo).
CREATE TABLE social.mixar_members (
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  state      text NOT NULL CHECK (state IN ('in', 'declined', 'left')),
  joined_at  timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mixar_id, user_id)
);
CREATE INDEX mixar_members_user_idx ON social.mixar_members (user_id, state);
CREATE INDEX mixar_members_in_idx ON social.mixar_members (mixar_id) WHERE state = 'in';

-- 3. A razão de cada item num Mixar de grupo: de quem é o gosto (`fans`, os ids de quem gosta, no momento da seleção).
--    `source` passa a aceitar 'all' (do gosto de todos) e 'some' (de só alguns); no Mixar a dois fica 'a', 'b' ou 'both'.
ALTER TABLE social.mixar_items ADD COLUMN fans uuid[];
ALTER TABLE social.mixar_items DROP CONSTRAINT IF EXISTS mixar_items_source_check;
ALTER TABLE social.mixar_items ADD CONSTRAINT mixar_items_source_check CHECK (source IN ('a', 'b', 'both', 'all', 'some'));

-- 4. Acabar o Mixar de um grupo quando fica com menos de 3 participantes (ativo) ou sem ninguém (pendente). Chamado pelo
--    gatilho de quem sai do grupo e pela API quando alguém sai do Mixar.
CREATE FUNCTION social.mixar_group_settle(gid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE social.mixars x SET status = 'ended', ended_at = now(), updated_at = now()
   WHERE x.group_id = gid AND x.status IN ('pending', 'active')
     AND (SELECT count(*) FROM social.mixar_members mm
            JOIN social.group_members gm ON gm.group_id = x.group_id AND gm.user_id = mm.user_id
            JOIN identity.users u ON u.id = mm.user_id AND u.status = 'active'
           WHERE mm.mixar_id = x.id AND mm.state = 'in') < CASE WHEN x.status = 'active' THEN 3 ELSE 1 END;
END $$;

-- Sair do grupo (pelo próprio pé, tirado por um admin, ou com a conta eliminada) = sair do Mixar do grupo.
CREATE FUNCTION social.mixar_group_member_gone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE social.mixar_members mm SET state = 'left', updated_at = now()
    FROM social.mixars x
   WHERE x.id = mm.mixar_id AND x.group_id = OLD.group_id AND x.status IN ('pending', 'active') AND mm.user_id = OLD.user_id AND mm.state = 'in';
  PERFORM social.mixar_group_settle(OLD.group_id);
  RETURN NULL;
END $$;
CREATE TRIGGER group_members_mixar_gone AFTER DELETE ON social.group_members
  FOR EACH ROW EXECUTE FUNCTION social.mixar_group_member_gone();

-- 5. Guardados: no grupo entra sozinho quando a maioria dos participantes reage sem «nah» (no Mixar a dois, os dois: igual a
--    antes, porque a maioria de 2 é 2).
CREATE OR REPLACE FUNCTION social.mixar_auto_save() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid uuid; need int := 2; got int;
BEGIN
  IF NEW.reaction = 'nah' THEN RETURN NULL; END IF;
  SELECT group_id INTO gid FROM social.mixars WHERE id = NEW.mixar_id;
  IF gid IS NULL THEN
    SELECT count(*) INTO got FROM social.mixar_reactions r WHERE r.mixar_id = NEW.mixar_id AND r.post_id = NEW.post_id AND r.reaction <> 'nah';
  ELSE
    SELECT count(*) / 2 + 1 INTO need FROM social.mixar_members mm WHERE mm.mixar_id = NEW.mixar_id AND mm.state = 'in';
    SELECT count(*) INTO got FROM social.mixar_reactions r
      JOIN social.mixar_members mm ON mm.mixar_id = r.mixar_id AND mm.user_id = r.user_id AND mm.state = 'in'
     WHERE r.mixar_id = NEW.mixar_id AND r.post_id = NEW.post_id AND r.reaction <> 'nah';
  END IF;
  IF got >= GREATEST(need, 2) THEN
    INSERT INTO social.mixar_saves (mixar_id, post_id, saved_by) VALUES (NEW.mixar_id, NEW.post_id, NULL) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

-- 6. O aviso novo na lista (categoria «Mixar»): 'mixar_group' alguém propôs um Mixar do grupo (ator = quem propôs).
--    data: { mixarId, name (o nome do grupo), groupId }. Os avisos da seleção e do desafio são os de sempre (mixar_daily,
--    mixar_pick, mixar_result), com `group: true` em data.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT DISTINCT kind FROM social.notifications
    UNION SELECT unnest(ARRAY['mixar_group'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;
