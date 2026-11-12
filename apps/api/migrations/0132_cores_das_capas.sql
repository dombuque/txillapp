-- As cores da capa de cada faixa do catálogo (para o fundo em gradiente do destaque no seletor da app), calculadas com sharp
-- quando a faixa entra ou a capa muda: { "cover": "<endereço da capa>", "colors": ["#rrggbb", "#rrggbb"] | null }.
ALTER TABLE content.music_catalog ADD COLUMN IF NOT EXISTS cover_tint jsonb;
