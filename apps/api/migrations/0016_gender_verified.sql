-- Género (definido pela própria pessoa; por defeito só ela o vê) e selo de perfil verificado (o processo de verificação fica para depois).
ALTER TABLE identity.users
  ADD COLUMN gender      text CHECK (gender IN ('female', 'male', 'other', 'unspecified')),
  ADD COLUMN show_gender boolean NOT NULL DEFAULT false,
  ADD COLUMN verified    boolean NOT NULL DEFAULT false,
  ADD COLUMN verified_at timestamptz;
