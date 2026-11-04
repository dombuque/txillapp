-- Posts por sítio: o nome do sítio já existia; agora, quando a pessoa escolhe um sítio da lista, guarda-se também a posição desse SÍTIO
-- (arredondada, ~110 m para locais e ~1 km para zonas), nunca a posição exata da pessoa. Serve para ver publicações perto.
ALTER TABLE content.posts
  ADD COLUMN location_lat double precision CHECK (location_lat BETWEEN -90 AND 90),
  ADD COLUMN location_lng double precision CHECK (location_lng BETWEEN -180 AND 180);
CREATE INDEX posts_location_label_idx ON content.posts (lower(location_label)) WHERE location_label IS NOT NULL AND removed_at IS NULL;
CREATE INDEX posts_location_geo_idx ON content.posts (location_lat, location_lng) WHERE location_lat IS NOT NULL AND removed_at IS NULL;
