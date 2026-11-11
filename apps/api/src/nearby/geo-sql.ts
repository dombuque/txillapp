/**
 * Contas de distância no SQL. O centro vem sempre já arredondado (2 casas decimais, ~1 km) e nunca é guardado.
 * `lat`/`lng` são os placeholders do centro (por omissão $2 e $3) e `km` o do raio.
 */
export const distKm = (latCol: string, lngCol: string, lat = '$2', lng = '$3') =>
  `(2 * 6371 * asin(least(1, sqrt(power(sin(radians(${latCol} - ${lat}::float8) / 2), 2) + cos(radians(${lat}::float8)) * cos(radians(${latCol})) * power(sin(radians(${lngCol} - ${lng}::float8) / 2), 2)))))`;

/** Pré-filtro por caixa (usa os índices de lat/lng) antes da conta exata. */
export const inBox = (latCol: string, lngCol: string, km: string, lat = '$2', lng = '$3') =>
  `(${latCol} BETWEEN ${lat}::float8 - ${km}::float8 / 111.0 AND ${lat}::float8 + ${km}::float8 / 111.0
    AND ${lngCol} BETWEEN ${lng}::float8 - ${km}::float8 / (111.32 * GREATEST(cos(radians(${lat}::float8)), 0.01))
                      AND ${lng}::float8 + ${km}::float8 / (111.32 * GREATEST(cos(radians(${lat}::float8)), 0.01)))`;

/** Arredonda a posição de quem pede a 2 casas decimais (~1 km) antes de qualquer consulta. */
export const coarse = (n: number) => Math.round(n * 100) / 100;

/** Tamanho da quadrícula da presença (~1,5 km): só se guarda o centro da quadrícula. */
export const CELL_DEG = 0.015;
export const snapToCell = (n: number) => Math.round((Math.floor(n / CELL_DEG) * CELL_DEG + CELL_DEG / 2) * 10_000) / 10_000;

/** Um ponto escolhido no mapa (o sítio de um TxillGroup): a mesma quadrícula da presença, sem sair dos limites. */
export const roundPlace = (lat: number, lng: number) => ({
  lat: Math.max(-90, Math.min(90, snapToCell(lat))),
  lng: Math.max(-180, Math.min(180, snapToCell(lng))),
});

/** Distância com uma casa decimal. */
export const km1 = (d: unknown) => Math.round(Number(d) * 10) / 10;

/** "agora", "há 20 min", "há 2 h": nunca mais fino do que blocos de 5 minutos. */
export function agoLabel(mins: number): string {
  if (mins < 5) return 'agora';
  if (mins < 60) return `há ${Math.floor(mins / 5) * 5} min`;
  return `há ${Math.floor(mins / 60)} h`;
}

/**
 * A posição que SAI de uma publicação (alias `p`), com `v` = LEFT JOIN content.venues v ON v.id = p.venue_id.
 * - Publicada como um local aprovado e no mapa: a posição do local (é um sítio público).
 * - Publicada como um local que saiu do mapa: nenhuma (como em "À tua volta"), salvo para quem gere o local (`viewer`,
 *   o placeholder de quem vê), que já vê a posição do local na página dele.
 * - Todas as outras: no máximo 2 casas decimais (~1 km), também as antigas que guardaram 3.
 * Usa-se em TODAS as respostas que mostram a posição de uma publicação (feed, detalhe, perfil, pesquisa, mapa).
 */
export const postGeo = (axis: 'lat' | 'lng', p = 'p', v = 'pv', viewer: string | null = null) =>
  `(CASE WHEN ${p}.location_lat IS NULL OR ${p}.location_lng IS NULL THEN NULL
         WHEN ${v}.id IS NOT NULL AND ${v}.review_status = 'approved' AND ${v}.show_on_map AND ${v}.lat IS NOT NULL AND ${v}.lng IS NOT NULL THEN ${v}.${axis}
         WHEN ${v}.id IS NOT NULL AND NOT ${v}.show_on_map THEN ${
           viewer
             ? `(CASE WHEN ${v}.lat IS NOT NULL AND ${v}.lng IS NOT NULL AND (${v}.owner_id = ${viewer} OR EXISTS (SELECT 1 FROM content.venue_managers vm WHERE vm.venue_id = ${v}.id AND vm.user_id = ${viewer} AND vm.status = 'active')) THEN ${v}.${axis} END)`
             : 'NULL'
         }
         ELSE round(${p}.location_${axis}::numeric, 2)::float8 END)`;

/** Publicada como um local que saiu do mapa: a posição dela não conta para nada que dependa de sítio (alias `p`). */
export const notHiddenVenuePost = (p = 'p') => `NOT EXISTS (SELECT 1 FROM content.venues hv WHERE hv.id = ${p}.venue_id AND NOT hv.show_on_map)`;
