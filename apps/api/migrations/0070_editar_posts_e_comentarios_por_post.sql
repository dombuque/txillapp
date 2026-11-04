-- Editar o texto de uma publicação (fica marcada como editada) e desativar os comentários de uma publicação ou de um story.
ALTER TABLE content.posts
  ADD COLUMN comments_off boolean NOT NULL DEFAULT false,
  ADD COLUMN edited_at timestamptz;
ALTER TABLE content.stories
  ADD COLUMN comments_off boolean NOT NULL DEFAULT false;
