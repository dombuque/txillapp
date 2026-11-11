-- Índices do mapa ("À tua volta").
-- Os locais e os eventos do mapa filtram sempre por uma caixa de lat/lng à volta de quem pede, e só entram locais
-- aprovados e no mapa (review_status = 'approved' AND show_on_map). Este índice parcial cobre exatamente esses locais:
-- a caixa (lat BETWEEN ... AND lng BETWEEN ...) usa-o e os locais em análise ou fora do mapa nem entram nele.
-- (As publicações já têm o seu: posts_location_geo_idx, da 0073; os TxillGroups o groups_map_place_idx, da 0104.)
CREATE INDEX IF NOT EXISTS venues_map_geo_idx ON content.venues (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL AND show_on_map AND review_status = 'approved';
