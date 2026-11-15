-- Limpeza única: as cópias guardadas (content.post_downloads, com a marca e o cartão do fim) que deixaram de ser permitidas
-- antes de «desligar apaga logo» existir — publicações de contas com «Deixar guardar» desligado, privadas ou de menores (ou
-- sem data de nascimento), e os duetos feitos com o vídeo dessas contas. Tiram-se as linhas e os ficheiros ficam marcados
-- como apagados: a limpeza de sempre (MediaService.sweepDeleted) tira-os do armazenamento. Quem tem direito volta a ter uma
-- cópia nova quando a pedir.
WITH blocked AS (
  SELECT id FROM identity.users
   WHERE NOT allow_downloads OR is_private OR birth_date IS NULL OR birth_date > (current_date - interval '18 years')
), gone AS (
  DELETE FROM content.post_downloads d
   WHERE d.post_id IN (SELECT p.id FROM content.posts p WHERE p.author_id IN (SELECT id FROM blocked))
      OR d.post_id IN (SELECT rx.post_id FROM content.post_remixes rx JOIN content.posts o ON o.id = rx.original_id
                        WHERE rx.kind = 'duet' AND o.author_id IN (SELECT id FROM blocked))
  RETURNING d.media_id
)
UPDATE content.media_assets m SET status = 'deleted' FROM gone WHERE m.id = gone.media_id;
