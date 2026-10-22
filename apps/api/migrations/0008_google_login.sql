-- Login com Google: o identificador estável da Google (sub). Contas só-Google não têm password.
ALTER TABLE identity.users ADD COLUMN google_sub text UNIQUE;
