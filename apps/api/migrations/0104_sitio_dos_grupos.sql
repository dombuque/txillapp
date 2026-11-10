-- O sítio de um TxillGroup no mapa, quando o plano não tem um local do Txillapp aprovado.
-- Um admin escolhe um ponto no mapa; guarda-se SÓ arredondado (o centro da quadrícula da malta, ver nearby/geo-sql.ts),
-- nunca o ponto exato. O nome (ex. "Costa do Sol") é opcional e só existe com o ponto.
-- Para aparecer em "À tua volta" (público ou privado no mapa), o grupo precisa de um sítio: o local aprovado do plano
-- (tem prioridade) ou este ponto.
ALTER TABLE social.groups
  ADD COLUMN map_lat double precision CHECK (map_lat BETWEEN -90 AND 90),
  ADD COLUMN map_lng double precision CHECK (map_lng BETWEEN -180 AND 180),
  ADD COLUMN map_label text CHECK (char_length(map_label) <= 80),
  ADD CONSTRAINT groups_map_place_check CHECK ((map_lat IS NULL) = (map_lng IS NULL) AND (map_label IS NULL OR map_lat IS NOT NULL));

-- "À tua volta": grupos pelo ponto escolhido (pré-filtro por caixa).
CREATE INDEX groups_map_place_idx ON social.groups (map_lat, map_lng) WHERE map_lat IS NOT NULL;
