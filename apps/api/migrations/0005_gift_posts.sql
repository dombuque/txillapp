-- Publicações do tipo "X presenteou Y" (anúncio de um presente directo a uma pessoa).
ALTER TABLE content.posts
  ADD COLUMN kind text NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'gift')),
  ADD COLUMN gift_recipient_id uuid REFERENCES identity.users(id),
  ADD COLUMN gift_amount bigint CHECK (gift_amount > 0),
  ADD COLUMN gift_transaction_id uuid UNIQUE REFERENCES ledger.transactions(id),
  ADD CONSTRAINT gift_post_fields CHECK (
    (kind = 'gift') = (gift_recipient_id IS NOT NULL AND gift_amount IS NOT NULL AND gift_transaction_id IS NOT NULL)
  );
