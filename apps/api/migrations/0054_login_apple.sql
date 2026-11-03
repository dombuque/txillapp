-- Iniciar sessão com a Apple (obrigatório na App Store quando há login com a Google).
ALTER TABLE identity.users ADD COLUMN apple_sub text UNIQUE;
