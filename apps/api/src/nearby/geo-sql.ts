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

/** Distância com uma casa decimal. */
export const km1 = (d: unknown) => Math.round(Number(d) * 10) / 10;

/** "agora", "há 20 min", "há 2 h": nunca mais fino do que blocos de 5 minutos. */
export function agoLabel(mins: number): string {
  if (mins < 5) return 'agora';
  if (mins < 60) return `há ${Math.floor(mins / 5) * 5} min`;
  return `há ${Math.floor(mins / 60)} h`;
}
