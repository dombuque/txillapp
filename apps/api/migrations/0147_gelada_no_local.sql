-- «Paga-me uma»: o local no «Já paguei» (ver src/gelada/gelada.service.ts, claimPaid).
--
-- Quem paga pode dizer onde foi a gelada (`paid_venue_id`, que já existia em 0145). Não é um check-in oficial (esse continua
-- só com o QR do local): é uma etiqueta «no Bar X» na dívida, que só as duas pessoas veem (e quem vê o momento, se o
-- publicarem).
--
-- `paid_venue_near`: no «Já paguei», o telemóvel de quem pagou estava dentro do raio do local (GPS). A posição só serve para
-- esta conta e NUNCA se guarda: fica só este sim/não. O selo «✓ estiveram lá» vem disto ou de um check-in com o QR do local
-- (de qualquer uma das duas pessoas) na mesma hora, que se procura em content.checkins ao ler.
ALTER TABLE taste.gelada_debts ADD COLUMN IF NOT EXISTS paid_venue_near boolean NOT NULL DEFAULT false;

-- Apagar um local põe paid_venue_id a NULL (ON DELETE SET NULL): o índice evita percorrer o livro todo.
CREATE INDEX IF NOT EXISTS gelada_debts_venue_idx ON taste.gelada_debts (paid_venue_id) WHERE paid_venue_id IS NOT NULL;
