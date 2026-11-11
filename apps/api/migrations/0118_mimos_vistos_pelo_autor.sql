-- "Já vi os meus mimos", guardado na conta (e não só no aparelho): quem usa vários aparelhos (iPhone, computador,
-- Android) vê o anel "O teu mimo" apagar-se em todos. Guarda-se só a hora do story mais recente que o autor já viu:
-- os stories dele com created_at <= seen_at estão vistos; um mimo novo volta a pôr o anel a cores.
-- O autor continua a NÃO entrar em content.story_views (nem nas contagens, nem em "quem viu", nem nas estatísticas).
-- Ao eliminar a conta, a linha sai em auth.service (a conta fica anonimizada, por isso o CASCADE não chega).
CREATE TABLE content.story_own_seen (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL
);
