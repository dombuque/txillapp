-- Chamadas de voz e vídeo 1:1 (WebRTC de pessoa para pessoa). O servidor só faz a sinalização e guarda o registo.
CREATE TABLE social.calls (
  id uuid PRIMARY KEY,
  caller_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  video boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'declined', 'cancelled', 'missed', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  CHECK (caller_id <> callee_id)
);
-- Histórico de cada pessoa (as duas direções), do mais recente para o mais antigo.
CREATE INDEX calls_caller_idx ON social.calls (caller_id, id DESC);
CREATE INDEX calls_callee_idx ON social.calls (callee_id, id DESC);
-- "Está noutra chamada?" e a varredura das chamadas a tocar há demasiado tempo.
CREATE INDEX calls_live_caller_idx ON social.calls (caller_id) WHERE status IN ('ringing', 'active');
CREATE INDEX calls_live_callee_idx ON social.calls (callee_id) WHERE status IN ('ringing', 'active');
CREATE INDEX calls_live_status_idx ON social.calls (status, created_at) WHERE status IN ('ringing', 'active');

-- Quem me pode ligar: todos, quem eu sigo, só quem se segue um ao outro (por omissão) ou ninguém.
ALTER TABLE identity.users
  ADD COLUMN calls_allowed text NOT NULL DEFAULT 'mutual' CHECK (calls_allowed IN ('everyone', 'following', 'mutual', 'off'));

-- Notificação de chamada perdida.
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified', 'venue_invite', 'missed_call'));
