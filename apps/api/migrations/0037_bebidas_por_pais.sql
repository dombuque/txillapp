-- Bebidas por país: `countries` diz onde a bebida faz sentido (NULL = em todo o lado).
-- O catálogo mostra primeiro as do país onde a pessoa está e esconde as de outros países (a pessoa pode pedir para as ver).
ALTER TABLE taste.items ADD COLUMN IF NOT EXISTS countries text[];

UPDATE taste.items SET countries = ARRAY['MZ'] WHERE slug = 'beb-laurentina';
UPDATE taste.items SET countries = ARRAY['MZ'] WHERE slug = 'beb-2m';
UPDATE taste.items SET countries = ARRAY['MZ'] WHERE slug = 'beb-manica';
UPDATE taste.items SET countries = ARRAY['MZ'] WHERE slug = 'beb-txilar';
UPDATE taste.items SET countries = ARRAY['MZ'] WHERE slug = 'beb-impala';
UPDATE taste.items SET countries = ARRAY['MZ'] WHERE slug = 'beb-laurentina-preta';
UPDATE taste.items SET countries = ARRAY['MZ'] WHERE slug = 'beb-laurentina-clara';
UPDATE taste.items SET countries = ARRAY['MZ','ZA','ZW','MW','ZM','TZ'] WHERE slug = 'beb-castle';
UPDATE taste.items SET countries = ARRAY['MZ','ZA','ZW'] WHERE slug = 'beb-castle-lite';
UPDATE taste.items SET countries = ARRAY['ZA','MZ'] WHERE slug = 'beb-black-label';
UPDATE taste.items SET countries = ARRAY['ZA','MZ'] WHERE slug = 'beb-hunters-dry';
UPDATE taste.items SET countries = ARRAY['ZA','MZ'] WHERE slug = 'beb-hunters-gold';
UPDATE taste.items SET countries = ARRAY['ZA','MZ'] WHERE slug = 'beb-savanna';
UPDATE taste.items SET countries = ARRAY['ZA','MZ'] WHERE slug = 'beb-brutal-fruit';
UPDATE taste.items SET countries = ARRAY['NA','ZA','MZ'] WHERE slug = 'beb-windhoek';
UPDATE taste.items SET countries = ARRAY['PT','AO','MZ','CV','BR'] WHERE slug = 'beb-super-bock';
UPDATE taste.items SET countries = ARRAY['PT','AO','MZ','CV','BR'] WHERE slug = 'beb-sagres';
UPDATE taste.items SET countries = ARRAY['PT','AO','MZ','CV','BR'] WHERE slug = 'beb-cristal';
UPDATE taste.items SET countries = ARRAY['MZ','ZW','MW','ZA'] WHERE slug = 'beb-cerveja-milho';
UPDATE taste.items SET countries = ARRAY['MZ'] WHERE slug = 'beb-cajueiro';
UPDATE taste.items SET countries = ARRAY['MZ','MW','TZ'] WHERE slug = 'beb-sura';
UPDATE taste.items SET countries = ARRAY['MZ'] WHERE slug = 'beb-nipa';
UPDATE taste.items SET countries = ARRAY['MZ','ZW','MW'] WHERE slug = 'beb-kachasu';
UPDATE taste.items SET countries = ARRAY['TZ','KE','UG','MZ'] WHERE slug = 'beb-pombe';
UPDATE taste.items SET countries = ARRAY['MZ','ZW','ZA','MW'] WHERE slug = 'beb-maheu';
UPDATE taste.items SET countries = ARRAY['MZ','ZW','ZA'] WHERE slug = 'beb-mazoe';
UPDATE taste.items SET countries = ARRAY['MZ','ZA'] WHERE slug = 'beb-predator';
UPDATE taste.items SET countries = ARRAY['PT','MZ','AO','CV','BR'] WHERE slug = 'beb-ginjinha';
UPDATE taste.items SET countries = ARRAY['PT','MZ','AO','CV'] WHERE slug = 'beb-licor-beirao';
UPDATE taste.items SET countries = ARRAY['PT','MZ','AO','CV','BR'] WHERE slug = 'beb-vinho-verde';

-- Mais cervejas (locais e regionais) e algumas tradicionais.
INSERT INTO taste.items (id, slug, name, kind, category, alcoholic, countries)
SELECT md5('taste:' || v.slug)::uuid, v.slug, v.name, v.kind, v.category, v.alcoholic, v.countries
FROM (VALUES
  ('beb-laurentina-premium', 'Laurentina Premium', 'bebida', 'cerveja', true, ARRAY['MZ']),
  ('beb-castle-lager', 'Castle Lager', 'bebida', 'cerveja', true, ARRAY['MZ','ZA','ZW','MW','ZM','TZ']),
  ('beb-hansa-pilsener', 'Hansa Pilsener', 'bebida', 'cerveja', true, ARRAY['ZA','MZ','NA','ZW']),
  ('beb-flying-fish', 'Flying Fish', 'bebida', 'cerveja', true, ARRAY['ZA','MZ','NA','ZW']),
  ('beb-lion-lager', 'Lion Lager', 'bebida', 'cerveja', true, ARRAY['ZA','MZ','NA','ZW']),
  ('beb-redd-s', 'Redd''s', 'bebida', 'cerveja', true, ARRAY['ZA','MZ','NA','ZW']),
  ('beb-hunters-edge', 'Hunters Edge', 'bebida', 'cerveja', true, ARRAY['ZA','MZ','NA','ZW']),
  ('beb-windhoek-draught', 'Windhoek Draught', 'bebida', 'cerveja', true, ARRAY['ZA','MZ','NA','ZW']),
  ('beb-windhoek-lager', 'Windhoek Lager', 'bebida', 'cerveja', true, ARRAY['ZA','MZ','NA','ZW']),
  ('beb-tafel-lager', 'Tafel Lager', 'bebida', 'cerveja', true, ARRAY['NA']),
  ('beb-zambezi-lager', 'Zambezi Lager', 'bebida', 'cerveja', true, ARRAY['ZW','MZ']),
  ('beb-eagle-lager', 'Eagle Lager', 'bebida', 'cerveja', true, ARRAY['ZW','MZ']),
  ('beb-bohlingers', 'Bohlingers', 'bebida', 'cerveja', true, ARRAY['ZW','MZ']),
  ('beb-mosi', 'Mosi', 'bebida', 'cerveja', true, ARRAY['ZM']),
  ('beb-rhino-lager', 'Rhino Lager', 'bebida', 'cerveja', true, ARRAY['ZM']),
  ('beb-kuche-kuche', 'Kuche Kuche', 'bebida', 'cerveja', true, ARRAY['MW']),
  ('beb-carlsberg-green', 'Carlsberg Green', 'bebida', 'cerveja', true, ARRAY['MW']),
  ('beb-safari-lager', 'Safari Lager', 'bebida', 'cerveja', true, ARRAY['TZ']),
  ('beb-kilimanjaro', 'Kilimanjaro', 'bebida', 'cerveja', true, ARRAY['TZ']),
  ('beb-serengeti-lager', 'Serengeti Lager', 'bebida', 'cerveja', true, ARRAY['TZ']),
  ('beb-tusker', 'Tusker', 'bebida', 'cerveja', true, ARRAY['KE']),
  ('beb-white-cap', 'White Cap', 'bebida', 'cerveja', true, ARRAY['KE']),
  ('beb-balozi', 'Balozi', 'bebida', 'cerveja', true, ARRAY['KE']),
  ('beb-nile-special', 'Nile Special', 'bebida', 'cerveja', true, ARRAY['UG']),
  ('beb-club-pilsener', 'Club Pilsener', 'bebida', 'cerveja', true, ARRAY['UG']),
  ('beb-bell-lager', 'Bell Lager', 'bebida', 'cerveja', true, ARRAY['UG']),
  ('beb-cuca', 'Cuca', 'bebida', 'cerveja', true, ARRAY['AO']),
  ('beb-nocal', 'Nocal', 'bebida', 'cerveja', true, ARRAY['AO']),
  ('beb-eka', 'Eka', 'bebida', 'cerveja', true, ARRAY['AO']),
  ('beb-biral', 'Biral', 'bebida', 'cerveja', true, ARRAY['AO']),
  ('beb-super-bock-stout', 'Super Bock Stout', 'bebida', 'cerveja', true, ARRAY['PT','AO','MZ','CV','BR']),
  ('beb-sagres-preta', 'Sagres Preta', 'bebida', 'cerveja', true, ARRAY['PT','AO','MZ','CV','BR']),
  ('beb-sagres-radler', 'Sagres Radler', 'bebida', 'cerveja', true, ARRAY['PT','AO','MZ','CV','BR']),
  ('beb-sagres-branca', 'Sagres Branca', 'bebida', 'cerveja', true, ARRAY['PT','AO','MZ','CV','BR']),
  ('beb-cintra', 'Cintra', 'bebida', 'cerveja', true, ARRAY['PT','AO','MZ','CV','BR']),
  ('beb-super-bock-abadia', 'Super Bock Abadia', 'bebida', 'cerveja', true, ARRAY['PT','AO','MZ','CV','BR']),
  ('beb-brahma', 'Brahma', 'bebida', 'cerveja', true, ARRAY['BR']),
  ('beb-skol', 'Skol', 'bebida', 'cerveja', true, ARRAY['BR']),
  ('beb-antarctica', 'Antarctica', 'bebida', 'cerveja', true, ARRAY['BR']),
  ('beb-itaipava', 'Itaipava', 'bebida', 'cerveja', true, ARRAY['BR']),
  ('beb-bohemia', 'Bohemia', 'bebida', 'cerveja', true, ARRAY['BR']),
  ('beb-eisenbahn', 'Eisenbahn', 'bebida', 'cerveja', true, ARRAY['BR']),
  ('beb-strela', 'Strela', 'bebida', 'cerveja', true, ARRAY['CV']),
  ('beb-rosema', 'Rosema', 'bebida', 'cerveja', true, ARRAY['ST']),
  ('beb-star-lager', 'Star Lager', 'bebida', 'cerveja', true, ARRAY['NG']),
  ('beb-gulder', 'Gulder', 'bebida', 'cerveja', true, ARRAY['NG']),
  ('beb-trophy', 'Trophy', 'bebida', 'cerveja', true, ARRAY['NG']),
  ('beb-legend', 'Legend', 'bebida', 'cerveja', true, ARRAY['NG']),
  ('beb-goldberg', 'Goldberg', 'bebida', 'cerveja', true, ARRAY['NG']),
  ('beb-club-premium', 'Club Premium', 'bebida', 'cerveja', true, ARRAY['GH']),
  ('beb-star-gold', 'Star Gold', 'bebida', 'cerveja', true, ARRAY['GH']),
  ('beb-gazelle', 'Gazelle', 'bebida', 'cerveja', true, ARRAY['SN']),
  ('beb-peroni', 'Peroni', 'bebida', 'cerveja', true, NULL),
  ('beb-beck-s', 'Beck''s', 'bebida', 'cerveja', true, NULL),
  ('beb-hoegaarden', 'Hoegaarden', 'bebida', 'cerveja', true, NULL),
  ('beb-leffe', 'Leffe', 'bebida', 'cerveja', true, NULL),
  ('beb-desperados', 'Desperados', 'bebida', 'cerveja', true, NULL),
  ('beb-paulaner', 'Paulaner', 'bebida', 'cerveja', true, NULL),
  ('beb-erdinger', 'Erdinger', 'bebida', 'cerveja', true, NULL),
  ('beb-kronenbourg-1664', 'Kronenbourg 1664', 'bebida', 'cerveja', true, NULL),
  ('beb-duvel', 'Duvel', 'bebida', 'cerveja', true, NULL),
  ('beb-asahi', 'Asahi', 'bebida', 'cerveja', true, NULL),
  ('beb-tiger', 'Tiger', 'bebida', 'cerveja', true, NULL),
  ('beb-tsingtao', 'Tsingtao', 'bebida', 'cerveja', true, NULL),
  ('beb-sapporo', 'Sapporo', 'bebida', 'cerveja', true, NULL),
  ('beb-coors-light', 'Coors Light', 'bebida', 'cerveja', true, NULL),
  ('beb-miller-lite', 'Miller Lite', 'bebida', 'cerveja', true, NULL),
  ('beb-bud-light', 'Bud Light', 'bebida', 'cerveja', true, NULL),
  ('beb-michelob-ultra', 'Michelob Ultra', 'bebida', 'cerveja', true, NULL),
  ('beb-blue-moon', 'Blue Moon', 'bebida', 'cerveja', true, NULL),
  ('beb-newcastle-brown-ale', 'Newcastle Brown Ale', 'bebida', 'cerveja', true, NULL),
  ('beb-foster-s', 'Foster''s', 'bebida', 'cerveja', true, NULL),
  ('beb-kilkenny', 'Kilkenny', 'bebida', 'cerveja', true, NULL),
  ('beb-tennent-s', 'Tennent''s', 'bebida', 'cerveja', true, NULL),
  ('beb-estrella-damm', 'Estrella Damm', 'bebida', 'cerveja', true, NULL),
  ('beb-san-miguel', 'San Miguel', 'bebida', 'cerveja', true, NULL),
  ('beb-mahou', 'Mahou', 'bebida', 'cerveja', true, NULL),
  ('beb-moretti', 'Moretti', 'bebida', 'cerveja', true, NULL),
  ('beb-corona-extra', 'Corona Extra', 'bebida', 'cerveja', true, NULL),
  ('beb-modelo', 'Modelo', 'bebida', 'cerveja', true, NULL),
  ('beb-pacifico', 'Pacifico', 'bebida', 'cerveja', true, NULL),
  ('beb-dos-equis', 'Dos Equis', 'bebida', 'cerveja', true, NULL),
  ('beb-heineken-silver', 'Heineken Silver', 'bebida', 'cerveja', true, NULL),
  ('beb-carlsberg-special-brew', 'Carlsberg Special Brew', 'bebida', 'cerveja', true, NULL),
  ('beb-stella-artois-cidre', 'Stella Artois Cidre', 'bebida', 'cerveja', true, NULL),
  ('beb-strongbow', 'Strongbow', 'bebida', 'cerveja', true, NULL),
  ('beb-magners', 'Magners', 'bebida', 'cerveja', true, NULL),
  ('beb-somersby', 'Somersby', 'bebida', 'cerveja', true, NULL),
  ('beb-heineken-0-0', 'Heineken 0.0', 'bebida', 'cerveja', false, NULL),
  ('beb-corona-zero', 'Corona Zero', 'bebida', 'cerveja', false, NULL),
  ('beb-beck-s-blue', 'Beck''s Blue', 'bebida', 'cerveja', false, NULL),
  ('beb-guinness-0-0', 'Guinness 0.0', 'bebida', 'cerveja', false, NULL),
  ('beb-chibuku', 'Chibuku', 'bebida', 'tradicional', true, ARRAY['MZ','ZW','MW','ZA']),
  ('beb-ucanhe', 'Ucanhe', 'bebida', 'tradicional', true, ARRAY['MZ'])
) AS v(slug, name, kind, category, alcoholic, countries)
ON CONFLICT (slug) DO NOTHING;
