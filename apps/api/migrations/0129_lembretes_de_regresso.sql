-- Lembretes de regresso: quem não abre o Txillapp há 3 dias ou mais recebe, de tempos a tempos, um aviso (push ou, sem push,
-- e-mail) com o que há de novo para si. Ver src/reminders/comeback-reminder.service.ts.
-- Uma linha por lembrete enviado: quem, quando, que etapa, por que canal e de que tipo era o texto (nunca o texto em si).
-- `cycle_at`: a última visita a que este lembrete responde (ao voltar à app começa um ciclo novo). A chave única
-- (user_id, cycle_at, stage) garante que a mesma etapa nunca sai duas vezes, mesmo com a tarefa a correr duas vezes ao mesmo tempo.
-- `returned_at`: quando a pessoa voltou a abrir a app depois deste lembrete (só para contar quantos voltaram em 48 h).
-- `channel = 'pending'`: lembrete reservado e a ser enviado (se nenhum canal resultar, a linha é apagada).
-- Apagado ao fim de 180 dias (pela própria tarefa); sai com a conta e entra na exportação de dados.
CREATE TABLE social.comeback_reminders (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  cycle_at    timestamptz NOT NULL,
  stage       smallint NOT NULL CHECK (stage BETWEEN 1 AND 5),
  channel     text NOT NULL CHECK (channel IN ('pending', 'push', 'email')),
  kind        text NOT NULL CHECK (kind IN ('messages', 'posts', 'stories', 'cheers', 'generic')),
  sent_at     timestamptz NOT NULL,
  returned_at timestamptz,
  UNIQUE (user_id, cycle_at, stage)
);
CREATE INDEX comeback_reminders_user_idx ON social.comeback_reminders (user_id, sent_at DESC);
CREATE INDEX comeback_reminders_sent_idx ON social.comeback_reminders (sent_at);
