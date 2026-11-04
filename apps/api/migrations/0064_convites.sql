-- Convites: cada pessoa tem um código; quem entra com ele e se torna ativa dá Txills aos dois (com limites e espera).
ALTER TABLE ledger.transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE ledger.transactions ADD CONSTRAINT transactions_type_check CHECK (type IN ('welcome_bonus', 'transfer', 'gift', 'topup', 'invite'));

CREATE TABLE social.invite_codes (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Uma linha por pessoa convidada. 'registered' → 'qualified' (ficou ativa) → 'paid' (o prémio de quem convidou foi libertado); 'blocked' = sem prémio.
CREATE TABLE social.referrals (
  invitee_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'qualified', 'paid', 'blocked')),
  reason text,
  ip_hash text,
  amount integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  qualified_at timestamptz,
  release_at timestamptz,
  paid_at timestamptz,
  CHECK (inviter_id <> invitee_id)
);
CREATE INDEX referrals_inviter_idx ON social.referrals (inviter_id, status);
CREATE INDEX referrals_status_idx ON social.referrals (status, release_at);
