/** Cidades com o centro já arredondado (a mesma lista do "Onde estás?" de À tua volta) e o sítio de partida dos mapas. */
export const CITIES: { name: string; lat: number; lng: number }[] = [
  { name: 'Maputo', lat: -25.97, lng: 32.57 },
  { name: 'Matola', lat: -25.96, lng: 32.46 },
  { name: 'Beira', lat: -19.84, lng: 34.84 },
  { name: 'Nampula', lat: -15.12, lng: 39.27 },
  { name: 'Inhambane', lat: -23.87, lng: 35.38 },
  { name: 'Tofo', lat: -23.85, lng: 35.54 },
  { name: 'Xai-Xai', lat: -25.05, lng: 33.64 },
  { name: 'Pemba', lat: -12.97, lng: 40.52 },
  { name: 'Quelimane', lat: -17.88, lng: 36.89 },
  { name: 'Tete', lat: -16.16, lng: 33.59 },
];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** A cidade com esse nome (sem ligar a acentos nem maiúsculas; "Maputo, Moçambique" também serve). */
export function cityByName(name: string | null | undefined): { name: string; lat: number; lng: number } | null {
  if (!name) return null;
  const n = fold(name.split(',')[0] ?? '');
  return CITIES.find((c) => fold(c.name) === n) ?? null;
}

/** Onde abre um mapa sem posição: a cidade escolhida (À tua volta), a do perfil, senão Maputo. */
export function startCity(...names: (string | null | undefined)[]): { name: string; lat: number; lng: number } {
  for (const n of names) {
    const c = cityByName(n);
    if (c) return c;
  }
  return CITIES[0];
}
