-- Esconder conversas (só para mim): a conversa sai da lista de Mensagens e do número de por ler e fica em
-- Mensagens → ⋯ → «Conversas escondidas». Mensagens novas NÃO a trazem de volta (só «Mostrar outra vez») e o aviso no
-- telemóvel vai sem pré-visualização («Nova mensagem», sem som de destaque). O outro lado não sabe.
-- Não confundir com `hidden_a`/`hidden_b` (0044): esses são os pedidos de mensagem recusados.
ALTER TABLE social.conversations
  ADD COLUMN hidden_at_a timestamptz,
  ADD COLUMN hidden_at_b timestamptz;
-- Nos TxillGroups: por pessoa (sai com a linha ao sair do grupo).
ALTER TABLE social.group_members ADD COLUMN hidden_at timestamptz;
