-- O que pode notificar cada pessoa: categorias desligadas (nada na lista e nada no telemóvel).
CREATE TABLE social.notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  off text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
